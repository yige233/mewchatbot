import {
    MewPlugin
} from "../lib/mian.js";
const jl_bot = Symbol("jl_bot"),
    js_permission = Symbol("js_permission");

class JoinLeave extends MewPlugin {
    constructor(permission_list) {
        super("join_leave", "message_handler");
        this[js_permission] = {
            join: permission_list.join || [],
            leave: permission_list.leave || [],
        };
    };
    interface(bot) { //插件接口
        this[jl_bot] = bot;
    };
    async join_handler(msg, command) {
        let message = await (async () => {
            if (!command[1] || command[1] == "help") return "使用 /join <据点id> <?据点准入问题> 来邀请我加入一个据点。";
            if (!this[js_permission].join.includes(msg.author_id)) return "没有权限！";
            try {
                await this[jl_bot].join(command[1], command[2] ? command[2] : null);
                return "成功加入该据点！";
            } catch (err) {
                if (err.status == 404) return "没有找到该据点！";
                if (err.status == 409) return "我已经是该据点的一员了哦！";
                if (err.status == "Network error") return "网络连接出现问题！";
                if (err.status == "Need answer") return "加入该据点需要回答问题：" + err.message;
                if (err.state) return "据点加入请求的状态：" + err.state;
                if (command[2] && command[2].length > 18) return "回答的长度超过了18个字的限制！";
                return JSON.stringify(err);
            };
        })();
        msg.reply({
            content: message
        });
    };
    async leave_handler(msg, command) {
        let message = await (async () => {
            if (!command[1] || command[1] == "help") return "使用 /leave <据点id> 来请我我离开一个据点。";
            if (!this[js_permission].leave.includes(msg.author_id)) return "没有权限！";
            try {
                await this[jl_bot].leave(command[1]);
                return "成功离开该据点！";
            } catch (err) {
                if (err.status == 404) return "一开始就不在该据点内!";
                return JSON.stringify(err)
            };
        })();
        msg.reply({
            content: message
        });
    };
};
export default JoinLeave;