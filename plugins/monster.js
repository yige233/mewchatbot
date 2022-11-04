import fetch from "node-fetch";
import jsdom from "jsdom";
import nedb from "nedb";
import {
    MewImgUpload,
    MewThought,
    MewPlugin
} from "../lib/mian.js";
import createLogger from "../lib/logger.js";

const logger = createLogger("MSR"),
    _runningStatus = Symbol("config"),
    _cooldownSec = Symbol("cooldown"),
    _db = Symbol("db"),
    _bot = Symbol("bot"),
    _postTarget = Symbol("targets"),
    cateList = new Map([
        [1, "新歌发布"],
        [2, "合作新闻"],
        [3, "周边情报"],
        [4, "彩蛋内容"],
        [5, "上线致辞"],
        [6, "SLOGAN"],
        [7, "资讯速递"],
        [8, "艺人近况"],
        [9, "艺人专访"],
        [10, "粉丝互动"],
        [11, "特别电台"],
    ]),
    {
        JSDOM
    } = jsdom;

class MSRHandler extends MewPlugin {
    constructor(cooldownSec = 20) {
        super("monster_siren_handler", "command_handler");
        this[_cooldownSec] = cooldownSec;
        this[_db] = new nedb({
            filename: './data/monster_siren.db',
            autoload: true
        });
        this[_runningStatus] = {
            isCooling: false,
            log: [],
        };
        this[_postTarget] = {
            imageBytesCount: 0,
            postList: []
        };
    };
    get token() {
        return this[_bot].token;
    };
    interface(bot) {
        this[_bot] = bot;
        this[_bot].on("heartbeat", () => this.handler());
    };
    isNew(list, data) {
        const rejectList = [1];
        if (list.includes(data.cid)) return [false, "[信息]该新闻已经搬运过了……"];
        if (rejectList.includes(data.cate)) return [false, "[信息]该新闻不在搬运范围内"];
        return [true, "[信息]开始搬运该新闻……"];
    };
    init() {
        this[_runningStatus].log = [];
        this[_runningStatus].isCooling = true;
        this.log("[信息][塞壬唱片]最后运行于：" + new Date().toLocaleString("chinese", {
            hour12: false
        }));
    };
    log(text) {
        this[_runningStatus].log.push(text);
    };
    doCooling() {
        this.log("[信息]结束……");
        return new Promise((resolve) => setTimeout(() => {
            this[_runningStatus].isCooling = false;
            resolve();
        }, this[_cooldownSec] * 1000));
    };
    async post(thought, target) {
        this.log("[信息]准备发帖……");
        for (let postItem of target.postList) {
            let latestResult = {};
            let tryCount = 0;
            while (tryCount <= 10) {
                latestResult = await this[_bot].postThought(thought, postItem.topicId || null).catch(err => err);
                if (latestResult.ok) {
                    this.log(`[信息]成功发帖！帖子id：`, latestResult.data.id);
                    logger.info("发帖成功，帖子id：", latestResult.data.id);
                    for (let topicId of postItem.remindList) this[_bot].sendMsg(topicId, {
                        thought: latestResult.data.id
                    }).catch(err => logger.warn("向通知列表发送帖子时出现错误:", err));
                    break;
                };
                tryCount++;
            };
            if (!latestResult.ok) logger.error("发帖时出现错误:", latestResult);
        };
        target.imageBytesCount = 0;
    };
    async handler() {
        if (this[_runningStatus].isCooling) return;
        this.init();
        const oudatedList = await this.readDb("msr");
        try {
            const res_getNews = await this.getNews();
            this.log(res_getNews.message);
            if (!res_getNews.ok) return await this.doCooling();
            const [res_isNew, message_isNew] = this.isNew(oudatedList, res_getNews.data);
            this.log(message_isNew);
            if (!res_isNew) return await this.doCooling();
            logger.info("有饼:", res_getNews.data);
            const thought = await this.buildThought(res_getNews.data.cid);
            if (this[_postTarget].imageBytesCount >= (10 * 1024 * 1024)) thought.addTitle(`⚠️流量注意：帖内图片共 ${Math.floor((this[_postTarget].imageBytesCount/1024/1024)*100)/100}MB\n${thought.title}`);
            await this.post(thought, this[_postTarget]);
            await this.writeDb("msr", res_getNews.data.cid);
        } catch (err) {
            this.log("[错误]" + err.message || err.status);
            logger.error(err);
        };
        this[_postTarget].imageBytesCount = 0;
        await this.doCooling();
    };
    async getNews() {
        const controller = new AbortController();
        const signal = controller.signal;
        setTimeout(() => controller.abort(), 10 * 1000);
        try {
            const reqestResult = await fetch("https://monster-siren.hypergryph.com/api/news", {
                signal: signal
            });
            if (!reqestResult.ok) return {
                ok: false,
                message: `[错误]${reqestResult.status} ${reqestResult.statusText}`,
                data: null
            };
            const requestJson = await reqestResult.json();
            const latestNews = requestJson.data.list[0];
            return {
                ok: true,
                message: `获取到了：${cateList.get(latestNews.cate)} - ${latestNews.title}`,
                data: latestNews
            };
        } catch (err) {
            return {
                ok: false,
                message: (err.name == "AbortError") ? "[错误]请求超时..." : err.message,
                data: null
            };
        };
    };
    async buildThought(cid) {
        const res = await fetch("https://monster-siren.hypergryph.com/api/news/" + cid).then(res => res.json());
        const thought = new myMewThought(this[_postTarget], this.token);
        await thought.htmlResolver(res.data);
        return thought;
    };
    async writeDb(key, data) {
        let existedData = await this.readDb(key);
        if (existedData.length) {
            existedData.push(data);
            this[_db].update({
                key: key,
            }, {
                $set: {
                    data: existedData,
                },
            });
        } else {
            this[_db].insert({
                key: key,
                data: [data]
            });
        };
    };
    async readDb(key) {
        return new Promise((resolve) => this[_db].find({
            key: key
        }, (err, doc) => resolve(doc[0] ? doc[0].data : [])));
    };
    addTarget(...targets) {
        for (let target of targets) this[_postTarget].postList.push({
            topicId: target.topicId || null,
            remindList: (Array.isArray(target.remindList)) ? target.remindList : target.remindList ? [target.remindList] : []
        });
    };
    queryStatus(msg) {
        let logStr = this[_runningStatus].log.join("\n") || "[信息]还么有准备好！";
        msg.reply({
            content: (logStr.length > 2000) ? `${logStr.slice(0, 1990)}......` : logStr
        });
    };
};

class myMewThought extends MewThought {
    constructor(target, token) {
        super();
        this.target = target;
        this.token = token;
    };
    async imgUpload(image) {
        let latestResult = {};
        let tryCount = 0;
        while (tryCount <= 10) {
            latestResult = await new MewImgUpload(this.token).imgUpload(image).catch(err => err);
            if (latestResult.ok) return latestResult;
            tryCount++;
        };
        return latestResult;
    };
    async htmlResolver(data) {
        function convert(element, styleList = []) {
            function getStyle(node) {
                if (node.nodeName == "CODE") return "code";
                if (node.nodeName == "STRONG") return "bold";
                if (node.nodeName == "A") return "link";
                if (node.nodeName == "I") return "italic";
                if (/line-through/.test(node.getAttribute("style"))) return "stike";
                return "";
            };

            function textNode(node) {
                styleList.push([node.nodeValue, []])
            };

            function singleElementNode(node) {
                styleList.push([node.textContent, [getStyle(node)], (node.nodeName == "A") ? node.getAttribute("href") : null]);
            };

            function mutipleElementNode(node) {
                for (let i of convert(node)) {
                    i[1].push(getStyle(node));
                    if (node.nodeName == "A") i.push(node.getAttribute("href"));
                    styleList.push(i);
                };
            };

            for (let node of element.childNodes) {
                if (node.nodeType == 3) textNode(node);
                if (node.nodeType == 1 && !node.children.length) singleElementNode(node);
                if (node.nodeType == 1 && node.children.length) mutipleElementNode(node);
            };
            return styleList;
        };
        const tagList = new Map([
            ["P", async (el) => {
                let styles = el.getAttribute("style");
                let align = "left";
                if (styles) {
                    let styleArray = styles.split(";").filter(x => x);
                    for (let i of styleArray) {
                        let [key, val] = i.split(":");
                        if (key == "text-align") align = val.trim();
                    };
                };
                let para = this.defPara(align);
                for (let i of convert(el)) para.addText(i[0], i[1], i[2] || null);
                this.addBlock(para.done());
            }],
            ["DIV", async (el) => {
                if (/image-wrap/.test(el.getAttribute("class"))) {
                    const imgSrc = el.querySelector("img").getAttribute("src");
                    const res = await this.imgUpload(imgSrc);
                    if (res.ok) {
                        this.addImg(res.data.id);
                        this.target.imageBytesCount += res.data.total_bytes;
                    };
                };
                if (/video-wrap/.test(el.getAttribute("class"))) {
                    this.addBlock(this.defPara("center").addText("_(:з」∠)_   这里是一个视频占位符~ ").addText("点我前往视频~", "link", `https://monster-siren.hypergryph.com/info/${data.cid}`).done());
                };
            }],
            ["default", async (el) => {}]
        ]);
        const article = new JSDOM(`<html><head></head><body>${data.content}</body></html>`).window.document.body.children;
        this.addTitle(`塞壬唱片：${cateList.get(data.cate)}\n${data.title}`);
        this.addHead(data.title, 2, "center");
        for (let el of article) {
            await (tagList.get(el.tagName) || tagList.get("default"))(el);
        };
        await this.addPrettyLink(`https://monster-siren.hypergryph.com/info/${data.cid}`, this.token).catch(err => {
            this.addBlock(this.defPara("center").addText(`https://monster-siren.hypergryph.com/info/${data.cid}`, "link").done());
        });
    };
};

export default MSRHandler