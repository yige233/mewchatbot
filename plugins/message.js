import {
    MewPlugin
} from "../lib/mian.js";

import createLogger from "../lib/logger.js";

const logger = createLogger("Message"),
    _bot = Symbol("_bot");
const stampMap = new Map([
    ["like", "赞"],
    ["comfort", "抱抱"],
    ["salute", "敬礼"],
    ["kusa", "草"],
    ["helpful", "大有帮助"],
    ["niubi", "牛逼"],
    ["lance", "欧吃矛"],
    ["tear", "泪目"],
    ["question", "？？？"],
    ["okashii", "什么鬼"],
    ["az", "啊这"],
    ["uhhuh", "嗯哼"],
    ["62126253897068544", "赞"],
    ["62126253934817280", "抱抱"],
    ["62126253989343232", "敬礼"],
    ["62126254123560960", "草"],
    ["62126254182281216", "大有帮助"],
    ["62126256115855360", "牛逼"],
    ["82700445042794496", "欧吃矛"],
    ["82700445055377408", "泪目"],
    ["82700445059571712", "？？？"],
    ["82700445080543232", "什么鬼"],
    ["82700445105709056", "啊这"],
    ["82700445114097664", "嗯哼"]
]);

class MessageHandler extends MewPlugin {
    constructor() { //构造时无需传入任何东西
        super("message_handler");
    };
    interface(bot) {
        this[_bot] = bot;
        this[_bot].on("message_create", (data) => {
            this.handler(data);
        });
    };
    getMessageType(message) {
        if (message.restricted) return "blacklist";
        if (message.media && message.media.length > 0) return "image";
        if (message.stamp) return "stamp";
        if (message.thought) return "thought";
        return "text";
    };
    getMessageContent(message) {
        if (message.type == "blacklist") return [null];
        if (message.type == "media") return [message.objects.media[message.media[0]].url, message.media[0]]
        if (message.type == "stamp") return [stampMap.get(message.stamp), message.stamp]
        if (message.type == "thought") return [message.thought];
        return [message.content];
    };
    handler(data) { //预处理消息
        const [message, rawMessage] = data;
        try {
            message.is_private = message.node_id ? false : true; //是否为私聊消息
            message.type = this.getMessageType(message); //消息类型
            message.author = { //消息发送者的信息
                id: message.author_id,
                name: message.objects.users[message.author_id].name,
                username: message.objects.users[message.author_id].username,
            };
            message.content = this.getMessageContent(message); //消息内容。返回数组
            message.reply = async (content, times, wait) => { //回复该消息。传入回复内容，打字次数，延迟时间。回复内容是一个消息对象，具体见main.js
                await this[_bot].typing(message.topic_id, times, wait).catch(err => logger.error(`请求失败：`, err));
                return this[_bot].sendMsg(message.topic_id, content).catch(err => logger.error(`请求失败：`, err));
            };
            message.test = (filter) => { //传入一个filter，返回该消息是否通过测试，和拒绝的原因。
                let match = (reg, str) => {
                    let res = str.match(new RegExp(reg));
                    return (res != null && res.index == 0);
                };
                filter.from = Array.isArray(filter.from) ? filter.from : [filter.from || "private"]; //默认只通过私聊消息
                filter.type = Array.isArray(filter.type) ? filter.type : [filter.type || "text"]; //默认只通过文字消息
                if (message.restricted) return [false, "blacklist"]; //拒绝原因：黑名单
                if (message.author.id === this[_bot].user.id) return [false, "self message"]; //拒绝原因：bot自己发出的消息
                if (!filter.from.includes("all")) {
                    if (message.is_private) {
                        if (!filter.from.includes("private")) return [false, "private message"]; //拒绝原因：是私聊消息
                    } else {
                        if (!filter.from.includes(message.topic_id)) return [false, "topic_id not match"]; //拒绝原因：不在指定的话题内
                    };
                };
                if (filter.type.includes("all")) return [true, null];
                if (filter.type.includes(message.type)) {
                    if (filter.type.includes("text")) {
                        if (filter.allow && match(filter.allow, message.content[0])) return [true, null];
                        if (filter.except && !match(filter.except, message.content[0])) return [true, null];
                        return [false, "test failed"]; //拒绝原因：正则测试不通过
                    };
                    return [true, null];
                };
                return [false, "message type not match"]; //拒绝原因：消息类型不符
            };
        } catch (err) {
            logger.error(`处理消息失败！`, err, rawMessage);
        };
    };
};
export default MessageHandler

/**
 * filter：一个简单的对象。
 *  {
 *      from:数组,控制消息是否来自于数组内的指定话题。有两个特殊的id：private, all, 分别是允许私聊消息和允许全部话题内的消息
 *      type:数组，控制消息的类型。如果是 all 则是允许任意类型消息。有text, image, stamp, thought, all
 *      allow:消息通过该正则表达式，则通过。与reject互斥，具有较高优先级
 *      reject:消息通过该正则表达式，则拒绝。与allow互斥，具有较低优先级
 *  }
 */