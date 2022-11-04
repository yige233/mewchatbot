import {
    MewPlugin
} from "../lib/mian.js";

import createLogger from "../lib/logger.js";

const logger = createLogger("Command"),
    ch_bot = Symbol("ch_bot"),
    ch_keyword = Symbol("ch_keyword"),
    ch_cmds = Symbol("ch_cmds"),
    ch_cmdalias = Symbol("ch_cmdalias"),
    c_handelr = Symbol("c_handelr"),
    c_mian_cmd = Symbol("c_mian_cmd"),
    c_alias = Symbol("c_alias"),
    c_on = Symbol("c_on");

class CommandHandler extends MewPlugin {
    constructor(keyword) { //构造时传入命令前缀，只有以该前缀开头的消息才会触发命令。默认为 /。特别地，传入 null 可以使解析器无视前缀，但这样无法触发未知命令时的提示。而且十分不稳定
        super("command_handler", "message_handler");
        this[ch_keyword] = (keyword === null) ? null : keyword || "/";
        this[ch_cmds] = new Map([]);
        this[ch_cmdalias] = new Map([]);
        this.add(new Command("default").handler((msg, command) => { //未知命令时的回复。只在私聊生效。
            if (!this.keyword) return;
            let cmds = [];
            for (let i of this[ch_cmds].keys()) {
                if (!this[ch_cmds].get(i).activate_list.includes("private")) continue;
                cmds.push(this.keyword + i);
            };
            cmds.shift();
            if (cmds)
                msg.reply({
                    content: `未知命令: ${msg.content[0]}。可用命令有：\n${cmds.join("\n")}`
                });
        }).at("private"));
    };
    get keyword() { //获取命令前缀。
        return this[ch_keyword];
    };
    interface(bot) { //插件接口
        this[ch_bot] = bot;
        this[ch_bot].on("message_create", (data) => {
            const [msg] = data;
            const filter = {
                from: "all",
                allow: this.keyword,
                type: "text"
            };
            const [res, err] = msg.test(filter);
            if (res) this.handler(Object.assign({}, msg));
        });
    };
    handler(msg) { //预处理命令
        function removeQuote(str) {
            if (/^\d{0,}$/.test(str)) return str;
            try {
                return JSON.parse(str);
            } catch {
                return str;
            };
        };
        let cmdstr = msg.content[0].slice(this.keyword ? this.keyword.length : 0),
            command = cmdstr.replace(/"[^"]*"/g, match => match.replace(/\s/g, "\ufffd")).split(/\s{1,}/g).map(i => removeQuote(i.replace(/\ufffd/g, " "))), //这里可以使用一个含有2001个字符元素的数组来检查消息体，避免出现错误替换的情况
            handler = (() => {
                if (this[ch_cmds].has(command[0])) return this[ch_cmds].get(command[0]);
                if (this[ch_cmdalias].has(command[0])) return this[ch_cmds].get(this[ch_cmdalias].get(command[0]));
                return this[ch_cmds].get("default");
            })(),
            ok = false;
        if (handler.activate_list.includes("private") && msg.is_private) ok = true;
        if (handler.activate_list.includes(msg.topic_id) && !msg.is_private) ok = true;
        if (ok) try {
            handler.action(msg, command);
        } catch (err) {
            logger.err(`命令 ${handler.main_command} 运行错误:`, err);
        };
    };
    add(command) { //注册命令。传入Command对象。
        this[ch_cmds].set(command.main_command, command);
        for (let i of command.alias_list) this[ch_cmdalias].set(i, command.main_command);
    };
};
class Command {
    constructor(cmd) { //构建一个命令对象，使用CommandHandler的add方法注册命令，传入命令的触发字符串
        this[c_mian_cmd] = cmd;
        this[c_handelr] = () => {};
        this[c_on] = [];
        this[c_alias] = [];
    };
    get main_command() { //获取主命令
        return this[c_mian_cmd];
    };
    get activate_list() { //获取命令可生效的位置（私聊、指定话题）
        return this[c_on];
    };
    get alias_list() { //获取命令的别名列表
        return this[c_alias];
    };
    get action() { //返回由handler方法定义的命令处理函数
        return this[c_handelr];
    };
    handler(fn) { //传入一个函数，用于处理命令。该函数接受msg、command两个参数，分别是触发命令的消息对象和解析过的命令数组
        this[c_handelr] = fn;
        return this;
    };
    at(...topic_id) { //传入函数生效的话题id。其中“私聊”的话题id为 private。可接受多个参数
        for (let i of topic_id) this[c_on].push(i);
        return this;
    };
    alias(...name) { //传入命令的别名，别名和主名一样能触发该命令。可接受多个参数
        for (let i of name) this[c_alias].push(i);
        return this;
    };
};
export {
    CommandHandler,
    Command
};