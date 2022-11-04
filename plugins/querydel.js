import nedb from "nedb";
import {
    MewPlugin
} from "../lib/mian.js";
const qd_db = Symbol("qd_db"),
    qd_maincmd = Symbol("qd_maincmd");

class QueryDel extends MewPlugin {
    constructor(main_command) {
        super("querydel", "message_handler");
        this[qd_db] = new nedb({
            filename: './data/deleted_thoughts.db',
            autoload: true
        });
        this[qd_maincmd] = main_command;
    };
    get main_command() {
        return this[qd_maincmd];
    };
    interface(bot) {
        bot.on("thought_delete", async (data) => {
            const [msg] = data;
            msg.deleted_at = new Date();
            this[qd_db].insert(msg);
        });
    };
    async handler(msg, command) {
        function compare(p) { //这是比较函数
            return function (m, n) {
                var a = m[p];
                var b = n[p];
                return a - b; //升序
            };
        };
        const message = await (async () => {
            if (command[1] == "help") return `使用 /${this.main_command} 查询自己被删除的想法；使用 /${this.main_command} <想法id> 来查询该帖子的详细信息；使用 /${this.main_command} help 来查看本说明。`;
            if (!command[1]) {
                let data = await new Promise((resolve) => this[qd_db].find({
                    author_id: msg.author.id
                }, (err, doc) => resolve(doc)));
                if (data.length) {
                    let thoughts = [];
                    let res = [...data];
                    res.sort(compare("deleted_at"));
                    for (let i of res) thoughts.push(`◇${(i.status) ? (i.status.length >= 30) ? i.status.slice(0, 30) + "……" : i.status : "<没有标题>"} ◇想法id：${i.id} ◇删除于：${new Date(i.deleted_at).toLocaleString("chinese", {
                            hour12: false
                        })}`);
                    return `找到${res.length}条您发布的被删除的想法：\n${thoughts.join("\n")}`;
                };
                return "没有找到您的被删除的帖子！";
            };
            if (command[1]) {
                let data = await new Promise((resolve) => this[qd_db].find({
                    author_id: msg.author.id,
                    id: command[1]
                }, (err, doc) => resolve(doc)));
                if (data.length == 0) return "没有找到有关想法！";
                let reply = [];
                data[0].status ? reply.push(`帖子内容：\n${data[0].status}`) : reply.push("<帖子没有标题>");
                data[0].post_content && reply.push(`长文内容：\n${data[0].post_content}`);
                data[0].media.length && reply.push(`帖子携带的媒体：\n${data[0].media}`);
                return reply.join("\n");
            };
        })();
        msg.reply({
            content: message
        });

    };
};
export default QueryDel;