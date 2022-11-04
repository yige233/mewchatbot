import fetch from "node-fetch";
import jsdom from "jsdom";
import nedb from "nedb";
import fs from "fs";
import path from "path";
import {
    MewImgUpload,
    MewThought,
    MewPlugin
} from "../lib/mian.js";
import createLogger from "../lib/logger.js";

const fsp = fs.promises,
    {
        JSDOM
    } = jsdom,
    logger = createLogger("Bili"),
    _runningStatus = Symbol("config"),
    _cooldownSec = Symbol("cooldownSec"),
    _postTargets = Symbol("postTargets"),
    _db = Symbol("db"),
    _bot = Symbol("bot");

class biliDynHander extends MewPlugin {
    constructor(cooldownSec = 20) {
        super("bili_dynamic_handler", "command_handler");
        this[_postTargets] = new Map(); //创建一个map用来存储想要搬运的up的uid
        this[_cooldownSec] = cooldownSec; //两次程序运行的间隔
        this[_db] = new nedb({ //读取数据库
            filename: './data/bili.db',
            autoload: true
        }); //连接已搬运的动态的数据
        this[_runningStatus] = {
            isCooling: false,
            log: [],
        }; //运行中需要的变量
    };
    get postTargets() {
        return this[_postTargets];
    };
    get token() {
        return this[_bot].token;
    };
    interface(bot) { //与框架交互
        this[_bot] = bot;
        this[_bot].on("heartbeat", () => this.handler());
    };
    log(...text) { //记录text到log中供命令查询
        this[_runningStatus].log.push(text.join(" "));
    };
    async writeDb(key, data) { //向数据库内写入数据
        let existedData = await this.readDb(key); //读取该key对应的值
        if (existedData.length) { //不是空数组，进行更新操作
            existedData.push(data);
            this[_db].update({
                key: key,
            }, {
                $set: {
                    data: existedData,
                },
            });
        } else { //是空数组，进行插入操作
            this[_db].insert({
                key: key,
                data: [data]
            });
        };
    };
    async readDb(key) { //读取数据库
        return new Promise((resolve) => this[_db].find({
            key: key
        }, (err, doc) => resolve(doc[0] ? doc[0].data : [])));
    };
    init() { //初始化本次运行的数据
        this[_runningStatus].log = []; //记录log
        this[_runningStatus].isCooling = true; //将运行状态锁定为运行中/冷却中
        this.log("[信息][bili]最后运行于：" + new Date().toLocaleString("chinese", {
            hour12: false
        }));
    };
    async getLatestDyn(uid) { //通过up主的用户id获取最新动态
        const controller = new AbortController();
        const signal = controller.signal;
        const outdatedList = await this.readDb(uid); //获取该目标的所有搬运记录
        const data = [];
        setTimeout(() => controller.abort(), 10 * 1000); //控制超时时间
        try {
            const reqestResult = await fetch(`https://api.vc.bilibili.com/dynamic_svr/v1/dynamic_svr/space_history?host_uid=${uid}`, {
                signal: signal
            });
            if (!reqestResult.ok) return { //http状态不对，返回false
                ok: false,
                message: `[错误]${reqestResult.status} ${reqestResult.statusText}`,
                data: null
            };
            const json = await reqestResult.json();
            if (json.code != 0) return {
                ok: false,
                message: `[错误]${json.message}`,
                data: null
            };
            if (!json.data.cards) return {
                ok: false,
                message: "[错误]UP主的uid可能不对，或者该用户没有动态...",
                data: null
            };
            for (let card of json.data.cards) {
                const dynamic = card.desc.dynamic_id_str;
                if (outdatedList.length == 0) {
                    data.push(dynamic);
                    break;
                };
                if (outdatedList.includes(dynamic)) break;
                data.push(dynamic);
            };
            return {
                ok: true,
                message: `[信息]@${json.data.cards[0].desc.user_profile.info.uname} 的最新动态:https://t.bilibili.com/${json.data.cards[0].desc.dynamic_id_str}`,
                data: data
            };
        } catch (err) {
            return {
                ok: false,
                message: (err.name == "AbortError") ? "[错误]请求超时..." : err.message,
                data: null
            };
        };
    };
    isNew(data) { //判断动态是否被搬运过
        if (data.length == 0) return [false, "[信息]该动态已经被搬运了……"];
        return [true, `[信息]开始搬运 ${data.length} 条新动态……`];
    };
    doCooling() { //等待冷却的秒数后，将运行状态变更为冷却完毕
        this.log("[信息]结束……");
        return new Promise((resolve) => setTimeout(() => {
            this[_runningStatus].isCooling = false;
            resolve();
        }, this[_cooldownSec] * 1000));
    };
    async post(thought, target) {
        this.log("[信息]准备发帖……");
        for (let postItem of target.postList) { //从该目标的发帖列表下取出目标发帖话题id
            let latestResult = {};
            let tryCount = 0;
            while (tryCount <= 10) {
                latestResult = await this[_bot].postThought(thought, postItem.topicId || null).catch(err => err);
                if (latestResult.ok) {
                    this.log(`[信息]成功发帖！帖子id：`, latestResult.data.id); //记录发帖id
                    logger.info("发帖成功，帖子id：", latestResult.data.id);
                    for (let topicId of postItem.remindList) this[_bot].sendMsg(topicId, { //从该贴的通知列表中取出目标通知话题id，并发送通知
                        thought: latestResult.data.id
                    }).catch(err => logger.warn("向通知列表发送帖子时出现错误:", err));
                    break;
                };
                tryCount++;
            };
            if (!latestResult.ok) logger.error("发帖时出现错误:", latestResult);
        };
    };
    async handler() { //主处理函数
        if (this[_runningStatus].isCooling) return; //如果运行状态是运行中/冷却中，立即中止本次运行
        this.init(); //初始化参数
        for (let uid of this.postTargets.keys()) { //从搬运列表中取出目标
            try {
                const res_latestDyn = await this.getLatestDyn(uid); //获取该uid的最新动态的id
                this.log(res_latestDyn.message); //记录上一步的结果
                if (!res_latestDyn.ok) continue; //如果获取最新动态失败，则跳出循环
                const [res_isNew, message_isNew] = this.isNew(res_latestDyn.data); //判断动态id是否是最新的
                this.log(message_isNew); //记录上一步的结果
                if (!res_isNew) continue; //如果上一步的判断结果为false，则跳出循环
                logger.info("有饼:", res_latestDyn.data);
                for (let dynamicId of res_latestDyn.data) {
                    const thought = await this.buildThought(dynamicId); //构建帖子
                    if (thought.imageBytesCount >= (10 * 1024 * 1024)) thought.addTitle(`⚠️流量注意：帖内图片共 ${Math.floor((thought.imageBytesCount/1024/1024)*100)/100}MB\n${thought.title}`); //为帖子添加流量提示
                    await this.post(thought, this.postTargets.get(uid)); //发帖
                    await this.writeDb(uid, dynamicId); //向数据库中写入新的搬运记录
                };
            } catch (err) { //捕获错误
                this.log("[错误]" + err.message || err.status); //记录错误信息
                logger.error(err);
            };
        };
        await this.doCooling(); //等待冷却
    };
    async buildThought(dynamicId) { //构建帖子
        const dynamicDetail = await fetch(`https://api.bilibili.com/x/polymer/web-dynamic/v1/detail?id=${dynamicId}`).then(res => res.json());
        const thought = new myMewThought(this.token); //构造帖子对象
        await thought.preHandler(dynamicDetail.data.item); //执行构建方法
        return thought; //返回构建好的帖子对象
    };
    addTarget(uid, ...targets) { //添加欲搬运动态的up的b站uid，并指定若干个搬运的target对象
        if (!uid) return false;
        const _targets = [];
        for (let target of targets) _targets.push({
            topicId: target.topicId || null,
            remindList: (Array.isArray(target.remindList)) ? target.remindList : target.remindList ? [target.remindList] : []
        });
        this.postTargets.set(uid, {
            postList: _targets
        });
        /**
         *     target对象的结构：
         *  {
         *      topicId:""//字符串，指定发表帖子的话题id
         *      remindList:[]//数组，包含一组话题id，是帖子发表后的通知列表，发表到topicId的帖子会被通知到该列表内的所有话题
         *  }
         */
    };
    queryStatus(msg) { //结合command_handler，实现命令查询发帖状态
        let logStr = this[_runningStatus].log.join("\n") || "[信息]还么有准备好！"; //将记录的log转换为字符串
        msg.reply({
            content: (logStr.length > 2000) ? `${logStr.slice(0, 1990)}......` : logStr
        });
    };
};

class myMewThought extends MewThought { //从MewThought类继承而来，传入搬运目标和token
    constructor(token) {
        super();
        this.imageBytesCount = 0;
        this.token = token;
    };
    async imgUpload(image, fileName = undefined) { //上传图片
        let latestResult = {};
        let tryCount = 0;
        while (tryCount <= 10) {
            latestResult = await new MewImgUpload(this.token).imgUpload(image, fileName).catch(err => err);
            if (latestResult.ok) return latestResult;
            tryCount++;
        };
        return latestResult;
    };
    async drawHandler(dynamic) { //处理图片
        const major = dynamic.modules.module_dynamic.major;
        const images = [];
        for (let image of major.draw.items) {
            const res = await this.imgUpload(image.src); //上传图片
            if (res.ok) {
                this.addImg(res.data.id); //添加图片
                this.imageBytesCount += res.data.total_bytes; //更新图片大小
                images.push(res.data.id);
            };
        };
        return images;
    };
    async articleHandler(dynamic) { //处理专栏
        /**
         * @desc 将元素转换为可用于MewThought对象的样式列表。传入待处理的元素，返回一个已处理好的数组
         * @param {*} element 需要转换的元素
         * @param {*} styleList (可选) 默认为空数组，也可以传入其他数组
         * @returns [ ["文字", ["样式代码", ...], "url链接"], ...] 其中，“url链接”在样式代码元素中不包含 link 时，为第一个文字元素相同。
         */
        function convert(element, styleList = []) {
            function getStyle(node) { //根据元素的数据，返回相应的样式代码
                if (node.nodeName == "CODE") return "code";
                if (node.nodeName == "STRONG") return "bold";
                if (node.nodeName == "A") return "link";
                if (node.nodeName == "I") return "italic";
                if (/line-through/.test(getComputedStyle(node).textDecoration)) return "stike";
                return "";
            };

            function textNode(node) { //处理纯文字节点
                styleList.push([node.nodeValue, []])
            };

            function singleElementNode(node) { //处理没有子元素的节点
                styleList.push([node.textContent, [getStyle(node)], (node.nodeName == "A") ? node.getAttribute("href") : node.textContent]);
            };

            function mutipleElementNode(node) { //处理有子元素的节点
                for (let i of convert(node)) { //自调用，对于这个节点，获取它的样式数组，对于该数组中的每个元素：
                    i[1].push(getStyle(node)); //在它的样式数组中添加父元素的样式代码
                    if (node.nodeName == "A") i.push(node.getAttribute("href")); //如果父节点是<a>则添加第三个url元素
                    styleList.push(i); //将调整后的元素添加进styleList中
                };
            };

            for (let node of element.childNodes) { //判断节点类型，并调用相应方法
                if (node.nodeType == 3) textNode(node);
                if (node.nodeType == 1 && !node.children.length) singleElementNode(node);
                if (node.nodeType == 1 && node.children.length) mutipleElementNode(node);
            };
            return styleList;
        };
        const major = dynamic.modules.module_dynamic.major
        const tagList = new Map([ //对于不同的元素，使用不同的处理方法
            ["P", async (el) => { //处理<p>元素
                let styles = el.getAttribute("style"); //获取对齐信息，默认为左对齐
                let align = "left";
                if (styles) {
                    let styleArray = styles.split(";").filter(x => x);
                    for (let i of styleArray) {
                        let [key, val] = i.split(":");
                        if (key == "text-align") align = val.trim();
                    };
                };
                let para = this.defPara(align);
                for (let i of convert(el)) para.addText(i[0], i[1], i[2]); //将元素转换为样式列表
                this.addBlock(para.done());
            }],
            ["BLOCKQUOTE", async (el) => { //处理引用
                let quote = this.defRichText("blockquote"); //创建引用文本块
                for (let i of el.children) {
                    let para = this.defPara();
                    for (let x of convert(i)) para.addText(x[0], x[1], x[2]); //将元素转换为样式列表
                    quote.addQuoteItem(para.done());
                };
                this.addBlock(quote.done());
            }],
            ["OL", async (el) => tagList.get("UL")(el)], //处理列表
            ["UL", async (el) => {
                let li = this.defRichText((el.tagName == "OL") ? "ordered_list" : "bullet_list"); //判断列表类型：有序列表或无序列表
                for (let i of el.querySelectorAll("li")) {
                    let para = this.defPara();
                    for (let x of convert(i.querySelector("p"))) para.addText(x[0], x[1], x[2] || null); //将元素转换为样式列表
                    li.addListItem(para.done());
                };
                this.addBlock(li.done());
            }],
            ["FIGURE", async (el) => { //处理图片
                let imgSrc = el.querySelector("img").getAttribute("data-src"); //获取并拼接图片链接
                imgSrc = (imgSrc.slice(0, 6) == "https:") ? imgSrc : "https:" + imgSrc;
                const res = await this.imgUpload(imgSrc); //上传图片
                if (res.ok) {
                    this.addImg(res.data.id); //添加图片
                    this.imageBytesCount += res.data.total_bytes; //更新图片大小
                };
            }],
            ["H1", async (el) => { //处理<h1>标签
                this.addHead(el.textContent, 2, "center"); //添加标题文字，2级居中
            }],
            ["default", async (el) => {}]
        ]);
        const article = await fetch(`https:${major.article.jump_url}`).then(res => res.text()).then(html => new JSDOM(html.replace(/<br>/g, "</p><p>")).window.document.querySelector(".article-container")); //用jsdom将字符串转换为dom对象
        for (let el of article.querySelector("#read-article-holder").children) {
            await (tagList.get(el.tagName) || tagList.get("default"))(el); //处理元素
        };
    };
    async archiveHandler(dynamic) { //处理视频入口
        const major = dynamic.modules.module_dynamic.major;
        const url = `https:${major.archive.jump_url}`;
        await this.addPrettyLink(url, this.token).catch(err => {
            this.addBlock(this.defPara("center").addText(url, "link").done());
        });
    };
    async pgcHandler(dynamic) { //处理番剧、剧集入口
        const major = dynamic.modules.module_dynamic.major;
        await this.addPrettyLink(major.pgc.jump_url, this.token).catch(err => {
            this.addBlock(this.defPara("center").addText(major.pgc.jump_url, "link").done());
        });
    };
    textHandler(dynamic) { //处理文字节点
        const paras = [this.defPara()]; //构建一个段落列表
        const desc = dynamic.modules.module_dynamic.desc;
        const nodeType = new Map([
            ["RICH_TEXT_NODE_TYPE_WEB", (para, node) => { //处理链接文字
                para.addText("🔗" + node.text, "link", node.jump_url);
            }],
            ["RICH_TEXT_NODE_TYPE_TOPIC", (para, node) => { //处理话题文字
                para.addText(node.text, "link", node.jump_url);
            }],
            ["RICH_TEXT_NODE_TYPE_AT", (para, node) => { //处理@文字
                para.addText(node.text, "link", `https://space.bilibili.com/${node.rid}`);
            }],
            ["RICH_TEXT_NODE_TYPE_EMOJI", (para, node) => { //处理行内表情
                para.addText(node.text, "link", node.emoji.icon_url);
            }],
            ["RICH_TEXT_NODE_TYPE_VOTE", (para, node) => { //处理投票文字
                para.addText("🗳" + node.text, ["link", "blod"], `https://t.bilibili.com/vote/h5/index/#/result?vote_id=${node.rid}`);
            }],
            ["RICH_TEXT_NODE_TYPE_CV", (para, node) => { //处理专栏链接
                para.addText("🖺" + node.text, ["link", "blod"], `https://www.bilibili.com/read/cv${node.rid}`);
            }],
            ["RICH_TEXT_NODE_TYPE_LOTTERY", (para, node) => { //处理抽奖文字
                para.addText("🎁" + node.text, ["link", "blod"], `https://t.bilibili.com/lottery/h5/index/#/result?business_type=1&business_id=${dynamic.id_str}`);
            }],
            ["RICH_TEXT_NODE_TYPE_OGV_SEASON", (para, node) => { //处理动态中插入的剧集传送门
                para.addText("📺" + node.text, ["link", "blod"], `https://www.bilibili.com/bangumi/play/ss${node.rid}`);
            }],
            ["RICH_TEXT_NODE_TYPE_TEXT", (para, node) => { //处理一般文字
                const textArray = node.text.split(/[\n|\r]+/g); //将文字按换行符拆分为数组
                for (let i in textArray) {
                    para.addText(textArray[i]);
                    if (i < textArray.length - 1) { //如果index不是文字数组的最后一个，就向段落列表增加一个新段落，并将指针para变量指向该段落
                        paras.push(this.defPara());
                        para = paras[paras.length - 1];
                    };
                };
            }],
            ["default", (para, node) => { //处理未知的node类型
                logger.warn("未知的node类型:", node.type, "使用了该type的动态:", dynamic.id_str);
                para.addText(node.orig_text);
            }]
        ]);
        for (let node of desc.rich_text_nodes)(nodeType.get(node.type) || nodeType.get("default"))(paras[paras.length - 1], node);
        for (let para of paras) this.addBlock(para.done());
    };
    topicHandler(dynamic) { //处理话题节点
        const topic = dynamic.modules.module_dynamic.topic;
        this.addBlock(this.defPara().addText("🗨" + topic.name, "link", topic.jump_url).done());
    };
    async creditHandler(dynamic) { //添加动态赖来源
        await this.addPrettyLink(`https://t.bilibili.com/${dynamic.id_str}`, this.token).catch(err => {
            this.addBlock(this.defPara("center").addText(`https://t.bilibili.com/${dynamic.id_str}`, "link").done());
        });
    };
    async titleAndCoverHandler({
        text = "啊啦，好像没有标题……",
        coverType = "local",
        image = null
    } = {}) { //添加帖子封面与标题
        const title = []; //标题列表
        const localCoverPath = await new Promise(async (resolve) => { //从本地获取封面
            let isFileExisted = async (fileName) => {
                    let fileObj = await fsp.lstat(fileName);
                    return fileObj.isFile();
                },
                files = await fsp.readdir("./images"),
                filesWithPath = files.map((fileName) => {
                    return path.join("./images", fileName);
                }),
                fileList = [];
            for (let file of filesWithPath) {
                if (await isFileExisted(file)) fileList.push(file);
            };
            resolve(fileList[Math.floor((Math.random() * fileList.length))]);
        });
        let addCover = async (image, fileName = undefined) => {
            const res = await this.imgUpload(image, fileName);
            if (res.ok) {
                this.addCover(res.data.id);
                this.imageBytesCount += res.data.total_bytes;
            };
        };
        text.split(/[\n|\r]+/g).forEach((value, index) => {
            if (index < 3) title.push(value);
        }); //添加标题
        this.addTitle(title.join("\n"));
        if (coverType == "url") return await addCover(image); //使用url
        if (coverType == "id") return this.addCover(image); //使用已存在的id
        if (coverType == "local") return await addCover(await fsp.readFile(localCoverPath), localCoverPath); //使用本地封面
    };
    async preHandler(dynamic, isForward = false) { //预处理动态
        const dynamicTypes = new Map([
            ["DYNAMIC_TYPE_FORWARD", async (dynamic, isForward = false) => { //处理转发动态
                await this.titleAndCoverHandler({
                    text: dynamic.modules.module_dynamic.desc.text,
                    coverType: "local"
                });
                this.textHandler(dynamic);
                this.addHead("以下为源动态", 2, "center");
                await this.preHandler(dynamic.orig, true);
            }],
            ["DYNAMIC_TYPE_DRAW", async (dynamic, isForward = false) => { //处理带图动态
                this.textHandler(dynamic);
                const images = await this.drawHandler(dynamic);
                if (!isForward) await this.titleAndCoverHandler({
                    text: dynamic.modules.module_dynamic.desc.text,
                    image: images[0],
                    coverType: "id"
                });
            }],
            ["DYNAMIC_TYPE_WORD", async (dynamic, isForward = false) => { //处理纯文字动态
                if (!isForward) await this.titleAndCoverHandler({
                    text: dynamic.modules.module_dynamic.desc.text,
                    coverType: "local"
                });
                this.textHandler(dynamic);
            }],
            ["DYNAMIC_TYPE_AV", async (dynamic, isForward = false) => { //处理视频动态
                const title = (dynamic.modules.module_dynamic.desc) ? dynamic.modules.module_dynamic.desc.text : dynamic.modules.module_dynamic.major.archive.title
                if (!isForward) await this.titleAndCoverHandler({
                    text: title,
                    image: dynamic.modules.module_dynamic.major.archive.cover,
                    coverType: "url"
                });
                if (dynamic.modules.module_dynamic.desc) this.textHandler(dynamic);
                await this.archiveHandler(dynamic);
            }],
            ["DYNAMIC_TYPE_ARTICLE", async (dynamic, isForward = false) => { //处理专栏动态
                if (!isForward) await this.titleAndCoverHandler({
                    text: dynamic.modules.module_dynamic.major.article.title,
                    image: dynamic.modules.module_dynamic.major.article.covers[0],
                    coverType: "url"
                });
                await this.articleHandler(dynamic);
            }],
            ["DYNAMIC_TYPE_PGC", async (dynamic, isForward = false) => { //处理番剧、剧集动态
                if (!isForward) await this.titleAndCoverHandler({
                    text: `${dynamic.modules.module_author.name} - ${dynamic.modules.module_dynamic.major.pgc.title}`,
                    image: dynamic.modules.module_dynamic.major.pgc.cover,
                    coverType: "url"
                });
                await this.pgcHandler(dynamic);
            }],
            ["default", async (dynamic, isForward = false) => { //处理未知动态
                //DYNAMIC_TYPE_COMMON_SQUARE
                logger.warn("未知类型的动态：", dynamic.type, dynamic.id_str);
            }]
        ]);
        if (dynamic.modules.module_dynamic.topic) this.topicHandler(dynamic); //如果有话题节点就处理话题节点
        await (dynamicTypes.get(dynamic.type, isForward) || dynamicTypes.get("default"))(dynamic, isForward); //按类型处理动态
        await this.creditHandler(dynamic); //最后附上credit
    };
};

export default biliDynHander