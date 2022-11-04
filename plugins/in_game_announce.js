import fetch from "node-fetch";
import jsdom from "jsdom";
import nedb from "nedb";
import {
    MewImgUpload,
    MewThought,
    MewPlugin
} from "../lib/mian.js";
import createLogger from "../lib/logger.js";

const logger = createLogger("InGameAnnounce"),
    _runningStatus = Symbol("config"),
    _cooldownSec = Symbol("cooldown"),
    _postTarget = Symbol("targets"),
    _db = Symbol("db"),
    _bot = Symbol("bot"),
    {
        JSDOM
    } = jsdom;

class inGameAnnoHandler extends MewPlugin {
    constructor(cooldownSec = 20) {
        super("in_game_announcement_handler", "command_handler");
        this[_cooldownSec] = cooldownSec;
        this[_db] = new nedb({
            filename: './data/in_game_announcement.db',
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
        if (list.includes(data.announceId)) return [false, "[信息]该公告已经被搬运……"];
        if (!/制作组通讯/.test(data.title)) return [false, "[信息]不是制作组通讯……"];
        if (data.group != "SYSTEM") return [false, "[信息]不是系统公告……"];
        return [true, "[信息]开始搬运游戏内公告……"];
    };
    init() {
        this[_runningStatus].log = [];
        this[_runningStatus].isCooling = true;
        this.log("[信息][游戏内公告]最后运行于：" + new Date().toLocaleString("chinese", {
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
        const oudatedList = await this.readDb("in_game_announcement");
        try {
            const res_getAnnounce = await this.getAnnouncement();
            this.log(res_getAnnounce.message);
            if (!res_getAnnounce.ok) return await this.doCooling();
            const [res_isNew, message_isNew] = this.isNew(oudatedList, res_getAnnounce.data);
            this.log(message_isNew);
            if (!res_isNew) return await this.doCooling();
            logger.info("有饼:", res_getAnnounce.data);
            const thought = await this.buildThought(res_getAnnounce.data.webUrl);
            if (this[_postTarget].imageBytesCount >= (10 * 1024 * 1024)) thought.addTitle(`⚠️流量注意：帖内图片共 ${Math.floor((this[_postTarget].imageBytesCount/1024/1024)*100)/100}MB\n${thought.title}`);
            await this.post(thought, this[_postTarget]);
            await this.writeDb("in_game_announcement", res_getAnnounce.data.announceId);
        } catch (err) {
            this.log("[错误]" + err.message || err.status);
            logger.error(err);
        };
        this[_postTarget].imageBytesCount = 0;
        await this.doCooling();
    };
    async getAnnouncement() {
        const controller = new AbortController();
        const signal = controller.signal;
        setTimeout(() => controller.abort(), 10 * 1000);
        try {
            const reqestResult = await fetch("https://ak-conf.hypergryph.com/config/prod/announce_meta/Android/announcement.meta.json", {
                signal: signal
            });
            if (!reqestResult.ok) return {
                ok: false,
                message: `[错误]${reqestResult.status} ${reqestResult.statusText}`,
                data: null
            };
            const requestJson = await reqestResult.json();
            const announce = requestJson.announceList[0];
            return {
                ok: true,
                message: `[信息]成功获取游戏内公告：${announce.title.replace(/\n/g," ")} ${announce.webUrl}`,
                data: announce
            };
        } catch (err) {
            return {
                ok: false,
                message: (err.name == "AbortError") ? "[错误]请求超时..." : err.message,
                data: null
            };
        };
    };
    async buildThought(url) {
        const thought = new myMewThought(this[_postTarget], this.token);
        await thought.htmlResolver(url);
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
            latestResult = await new MewImgUpload(this.token).imgUpload(image).catch(err => err);;
            if (latestResult.ok) return latestResult;
            tryCount++;
        };
        return latestResult;
    };
    async htmlResolver(url) {
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
                const imgSrc = el.querySelector("img").getAttribute("src");
                const res = await this.imgUpload(imgSrc);
                if (res.ok) {
                    this.addImg(res.data.id);
                    this.target.imageBytesCount += res.data.total_bytes;
                };
            }],
            ["default", async (el) => {}]
        ]);
        const article = await fetch(url).then(res => res.text()).then(html => new JSDOM(html.replace(/<br>/g, "</p><p>")).window.document.querySelector(".standerd-container"));
        const articleBody = article.querySelector(".content").children;
        if (article.querySelector(".banner-image-container")) {
            const imageBanner = article.querySelector(".banner-image-container").querySelector("img").getAttribute("src");
            const res = await this.imgUpload(imageBanner);
            if (res.ok) {
                this.addCover(res.data.id);
                this.target.imageBytesCount += res.data.total_bytes;
            };
        };
        if (article.querySelector(".head-title-container")) {
            const title = article.querySelector(".head-title-container").textContent.replace(/[\n|\s]/g, "");
            this.addTitle(title);
            this.addHead(title, 2, "center");
        };
        for (let el of articleBody) {
            await (tagList.get(el.tagName) || tagList.get("default"))(el);
        };
    };
};

export default inGameAnnoHandler