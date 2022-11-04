import {
    MewChatbot
} from "./lib/mian.js";
import {
    CommandHandler,
    Command
} from "./plugins/command.js";
import biliDynHander from "./plugins/bili.js";
import TerraHandler from "./plugins/terra.js";
import MSRHandler from "./plugins/monster.js";
import MessageHandler from "./plugins/message.js";
import JoinLeave from "./plugins/join-leave.js";
import QueryDel from "./plugins/querydel.js";
import inGameAnnoHandler from "./plugins/in_game_announce.js";
import rollHandler from "./plugins/roll.js";
import createLogger from "./lib/logger.js";

const logger = createLogger("Index"),
    topic_rose_newspaper = "68910888908099584",
    topic_penguin_express = "68595912817254400",
    topic_master = "71867357638897664",
    topic_helloworld = "123066524760023040",
    user_master = "68907366539980800",
    normal_props = {
        topicId: topic_helloworld,
        remindList: [topic_master, topic_helloworld]
    };

const bot = new MewChatbot("token"), //需要填入mew用户的token
    cmd = new CommandHandler(),
    join_leave = new JoinLeave({
        join: [user_master],
        leave: [user_master]
    }),
    querydel = new QueryDel("querydel"),
    bili = new biliDynHander(),
    roll = new rollHandler(),
    anno = new inGameAnnoHandler(),
    terra = new TerraHandler(),
    msr = new MSRHandler();

terra.addTarget(normal_props);

msr.addTarget(normal_props);

bili.addTarget("161775300", normal_props, {
    topicId: topic_penguin_express,
    remindList: [topic_master]
}); //@明日方舟
bili.addTarget("1579053316", normal_props); //@Wan顽子
bili.addTarget("2123591088", normal_props); //@CubesCollective
bili.addTarget("1883857209", normal_props); //@来自星尘
bili.addTarget("1265652806", normal_props); //@明日方舟终末地
bili.addTarget("1554642444", normal_props); //@重力井动画
bili.addTarget("11783021", {
    topicId: "199397092680683520", //哔哩哔哩番剧出差
    remindList: [topic_helloworld]
}); //@哔哩哔哩番剧出差

anno.addTarget(normal_props);

cmd.add(new Command("echo").handler(async (msg, command) => {
    command.shift();
    msg.reply({
        content: command.length ? command.join(" ") : "用法：echo <msg>"
    });
}).at("private", topic_helloworld));
cmd.add(new Command("reboot").handler(async (msg, command) => {
    if (![user_master].includes(msg.author_id)) return msg.reply({
        content: "没有权限！"
    });
    logger.info("重启bot……");
    bot.stopWS("手动重启");
    bot.startWS();
}).at("private", topic_helloworld));
cmd.add(new Command("saysth").handler(async (msg, command) => {
    let c_map = new Map([
        ["a", "a"],
        ["b", "b"],
        ["c", "c"],
        ["d", "d"],
        ["e", "e"],
        ["f", "f"],
        ["g", "g"],
        ["h", "h"],
        ["i", "i"],
        ["j", "j"],
        ["k", "k"],
        ["help", "help"],
        ["default", "a"]
    ]);
    let message = await (async () => {
        let c = c_map.get(command[1]) || c_map.get('default');
        if (c === "help") return `使用方法: /saysth [type]\ntype详见 https://developer.hitokoto.cn/sentence 中句子参数一节。`;
        let res = await fetch(`https://v1.hitokoto.cn/?c=${c}`);
        if (!res.ok) return `网络错误:${res.status+res.statusText}`;
        let json = await res.json();
        return `${json.hitokoto} \n--出自《${json.from}》。`;
    })();
    msg.reply({
        content: message
    });
}).at("private", topic_helloworld));
cmd.add(new Command("join").handler((message, command) => join_leave.join_handler(message, command)).at("private", topic_helloworld));
cmd.add(new Command("leave").handler((message, command) => join_leave.leave_handler(message, command)).at("private", topic_helloworld));
cmd.add(new Command(querydel.main_command).handler((message, command) => querydel.handler(message, command)).at("private", topic_helloworld));
cmd.add(new Command("roll")
    .handler((msg, command) => roll.handler(msg, command))
    .at("private", topic_helloworld));
cmd.add(new Command("bili")
    .handler((msg, command) => bili.queryStatus(msg))
    .at("private", topic_helloworld, topic_rose_newspaper)
    .alias("饼呢", "饼", "饼?", "饼！", "饼？", "饼呢?", "饼呢！", "饼呢？", "饼来"));
cmd.add(new Command("terra")
    .handler((msg, command) => terra.queryStatus(msg))
    .at("private", topic_helloworld, topic_rose_newspaper)
    .alias("泰拉"));
cmd.add(new Command("anno")
    .handler((msg, command) => anno.queryStatus(msg))
    .at("private", topic_helloworld, topic_rose_newspaper)
    .alias("公告"));
cmd.add(new Command("msr")
    .handler((msg, command) => msr.queryStatus(msg))
    .at("private", topic_helloworld, topic_rose_newspaper)
    .alias("塞壬唱片", "塞壬"));

await bot.load(new MessageHandler());
await bot.load(cmd);
await bot.load(roll);
await bot.load(bili);
await bot.load(terra);
await bot.load(anno);
await bot.load(msr);

bot.on("message_create", (data) => {
    const [msg] = data;
    const filter = {
        from: ["private", topic_helloworld],
        except: cmd.keyword,
        type: "text"
    };
    if (msg.test(filter)[0]) msg.reply({
        content: `你刚刚向我说了 ${msg.content[0]} 吗？`
    });
});
bot.on("message_create", (data) => {
    const [msg] = data;
    const filter = {
        from: ["private"],
        type: "stamp"
    };
    let stampMap = new Map([
        ["赞", "谢谢点赞哦！"],
        ["抱抱", "抱抱你！ヾ(≧▽≦*)o"],
        ["敬礼", "谢谢喜欢！"],
        ["草", "小心群割草机！"],
        ["大有帮助", "有帮助就好！"],
        ["牛逼", "也没那么牛逼啦！"],
        ["欧吃矛", "欧皇？哪里有欧皇？"],
        ["泪目", "泪目啦！"],
        ["？？？", "？？？？"],
        ["什么鬼", "好奇怪哦……"],
        ["啊这", "啊这……"],
        ["嗯哼", "嘿嘿嘿！"]
    ]);
    if (msg.test(filter)[0]) msg.reply({
        content: stampMap.get(msg.content[0])
    });
});
bot.on("message_create", (data) => {
    const [msg] = data;
    const filter = {
        from: ["private"],
        type: "thought"
    };
    if (msg.test(filter)[0]) msg.reply({
        content: `诶多，看懂帖子也很有难度呢……`
    });
});
bot.on("message_create", (data) => {
    const [msg] = data;
    const filter = {
        from: ["private"],
        type: "image"
    };
    if (msg.test(filter)[0]) msg.reply({
        content: `看懂图片什么的，果然还是不行啊……`
    });
});
bot.on("status_change", (status) => {
    logger.info(`bot状态变化:`, status);
    if (status == "offline") bot.startWS();
});
(() => {
    const mark = {
        timer: 0,
        count: 0,
        timeout_count: 1,
        close_at: 0
    };

    function init(time) {
        clearInterval(mark.timer);
        mark.count = 0;
        mark.timeout_count = 1;
        mark.close_at = time || 0;
    };
    bot.on("status_change", (status) => {
        if (status == "offline") {
            init(new Date());
            mark.timer = setInterval(() => {
                if (mark.timeout_count >= 30) process.exit(500);
                if (mark.count >= 120 * mark.timeout_count) {
                    bot.sendMsg(topic_master, {
                        content: `${new Date().toLocaleString("chinese", {
                            hour12: false
                        })}，距离 ${bot.user.name} 失去ws连接已经过了${mark.timeout_count*2}分钟！`
                    }).catch(err => logger.error(`长时间断线消息发送失败！`, err));
                    logger.info("重启bot……");
                    bot.stopWS("手动重启");
                    bot.startWS();
                    mark.timeout_count += 2;
                };
                mark.count++;
            }, 1000);
        };
        if (status == "online") {
            if (mark.close_at == 0) return;
            logger.info(`${bot.user.name} 重连耗时: ${(new Date()-mark.close_at)/1e3} s`);
            init();
        };
    });
})();
process.on("unhandledRejection", (error) => {
    logger.error("未被处理的Promise rejection:", error);
});
bot.startWS(() => logger.info(`bot上线：${bot.user.name}`));