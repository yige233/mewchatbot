import fetch from "node-fetch";
import nedb from "nedb";
import {
    MewImgUpload,
    MewThought,
    MewPlugin
} from "../lib/mian.js";
import createLogger from "../lib/logger.js";

const logger = createLogger("Terra"),
    _bot = Symbol("_bot"),
    _db = Symbol("_db"),
    _runningStatus = Symbol("_runningStatus"),
    _postTarget = Symbol("_postTarget"),
    _cooldownSec = Symbol("_cooldownSec");

class TerraHandler extends MewPlugin {
    constructor(cooldownSec = 20) {
        super("terra_handler", "message_handler");
        this[_cooldownSec] = cooldownSec;
        this[_db] = new nedb({
            filename: './data/terra.db',
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
    async imgUpload(image) { //上传图片
        let latestResult = {};
        let tryCount = 0;
        while (tryCount <= 10) {
            latestResult = await new MewImgUpload(this[_bot].token).imgUpload(image).catch(err => err);
            if (latestResult.ok) return latestResult;
            tryCount++;
        };
        return latestResult;
    };
    interface(bot) {
        this[_bot] = bot;
        this[_bot].on("heartbeat", () => this.handler());
    };
    init() {
        this[_runningStatus].log = [];
        this[_runningStatus].isCooling = true;
        this.log("[信息][Terra]最后运行于：" + new Date().toLocaleString("chinese", {
            hour12: false
        }));
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
    log(...text) {
        this[_runningStatus].log.push(text.join(" "));
    };
    async buildThought(data) {
        const thought = new MewThought();
        try {
            const comicInfo = await fetch(`https://terra-historicus.hypergryph.com/api/comic/${data.comicCid}`).then(res => res.json());
            const epInfo = await fetch(`https://terra-historicus.hypergryph.com/api/comic/${data.comicCid}/episode/${data.episodeCid}`).then(res => res.json());
            const refferenceUrl = `https://terra-historicus.hypergryph.com/comic/${data.comicCid}/episode/${data.episodeCid}`;
            let pageNum = 1;
            this.log("需要上传", epInfo.data.pageInfos.length, "张图片……");
            while (pageNum <= epInfo.data.pageInfos.length) {
                const controller = new AbortController();
                const signal = controller.signal;
                setTimeout(() => controller.abort(), 60 * 1000);
                logger.info("上传图片进度:", pageNum, "/", epInfo.data.pageInfos.length);
                try {
                    const result = await fetch(`https://terra-historicus.hypergryph.com/api/comic/${data.comicCid}/episode/${data.episodeCid}/page?pageNum=${pageNum}`, {
                        signal: signal
                    }).then(res => res.json());
                    if (result.code != 0) {
                        logger.warn("获取漫画图片url失败", result);
                        continue;
                    };
                    const image = await this.imgUpload(result.data.url);
                    if (image.ok) {
                        thought.addImg(image.data.id);
                        this[_postTarget].imageBytesCount += image.data.total_bytes;
                    } else {
                        thought.addBlock(thought.defPara("center").addText(result.data.url, "link").done());
                    };
                    pageNum++;
                } catch (err) {
                    logger.error("上传图片失败", err);
                    continue;
                };
                await new Promise((resolve) => setTimeout(resolve, 1000));
            };
            thought.addTitle(`【${data.title}】 ${epInfo.data.shortTitle||""} ${epInfo.data.title}`);
            thought.addBlock(thought.defPara().addText("关于 ").addText(data.title, "bold").addText("：").done(), thought.defRichText("blockquote").addQuoteItem(
                thought.defPara().addText(data.title).done(),
                thought.defPara().addText(data.subtitle).done(),
                thought.defPara().addText(epInfo.data.introduction).done()
            ).done());
            await thought.addPrettyLink(refferenceUrl, this[_bot].token).catch(() => {
                thought.addBlock(thought.defPara("center").addText(refferenceUrl, "link").done());
            });
            await this.imgUpload(comicInfo.data.cover).then(cover => {
                if (cover.ok) {
                    thought.addCover(cover.data.id);
                    this[_postTarget].imageBytesCount += cover.data.total_bytes;
                };
            });
            return thought;
        } catch (err) {
            throw {
                message: "构建帖子失败",
                err: err
            };
        };
    };
    async getLatestConmic() {
        const controller = new AbortController();
        const signal = controller.signal;
        setTimeout(() => controller.abort(), 10 * 1000);
        try {
            const reqestResult = await fetch(`https://terra-historicus.hypergryph.com/api/recentUpdate`, {
                signal: signal
            });
            if (!reqestResult.ok) return {
                ok: false,
                message: `[错误]${reqestResult.status} ${reqestResult.statusText}`,
                data: null
            };
            const requestJson = await reqestResult.json();
            if (requestJson.msg) return {
                ok: false,
                message: `[错误]${requestJson.msg}`,
                data: null
            };
            const comic = requestJson.data[0];
            return {
                ok: true,
                message: `[信息]最新的漫画：${comic.title} - ${comic.episodeShortTitle}`,
                data: comic
            };
        } catch (err) {
            return {
                ok: false,
                message: (err.name == "AbortError") ? "[错误]请求超时..." : err.message,
                data: null
            };
        };
    };
    isNew(list, data) {
        if (list.includes(`${data.comicCid}_${data.episodeCid}`)) return [false, "[信息]该漫画已经被搬运……"];
        return [true, "开始搬运漫画……"];
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
        const outdatedList = await this.readDb("terra");
        try {
            const res_latestComic = await this.getLatestConmic();
            this.log(res_latestComic.message);
            if (!res_latestComic.ok) return await this.doCooling();
            const [res_isNew, message_isNew] = this.isNew(outdatedList, res_latestComic.data);
            this.log(message_isNew);
            if (!res_isNew) return await this.doCooling();
            logger.info("有饼:", res_latestComic.data);
            const thought = await this.buildThought(res_latestComic.data);
            if (this[_postTarget].imageBytesCount >= 10 * 1024 * 1024) thought.addTitle(`⚠️流量注意：帖内图片共 ${Math.floor((this[_postTarget].imageBytesCount/1024/1024)*100)/100}MB\n${thought.title}`);
            await this.post(thought, this[_postTarget]);
            await this.writeDb("terra", `${res_latestComic.data.comicCid}_${res_latestComic.data.episodeCid}`);
        } catch (err) {
            logger.error(`发帖失败：`, err)
            this.log("[错误]发帖失败：" + err.message || err.status);
        };
        this[_postTarget].imageBytesCount = 0;
        await this.doCooling();
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
export default TerraHandler