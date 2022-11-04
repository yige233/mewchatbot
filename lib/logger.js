import tracer from "tracer";

const errLevel = new Map([
    ["log", "日志"],
    ["trace", "跟踪"],
    ["debug", "调试"],
    ["info", "信息"],
    ["warn", "警告"],
    ["error", "错误"],
    ["fetal", "致命"]
]);

function time() {
    return new Date().toLocaleString('zh-CN', {
        timeZone: 'Asia/Shanghai',
        hour12: false
    });
};

function myCreateLogger(label = "MewChatBot") {
    const logConf = {
        format: [
            `{{title}}: {{timestamp}}: ${label}: {{message}}`,
            {
                error: `{{title}}: {{timestamp}}: ${label}: {{message}} (位于 {{file}}:{{line}})`,
                warn: `{{title}}: {{timestamp}}: ${label}: {{message}} (位于 {{file}}:{{line}})`
            }
        ],
        preprocess: function (data) {
            data.title = errLevel.get(data.title) || data.title;
            data.timestamp = time();
        }
    };
    return tracer.console(logConf)
};
export default myCreateLogger;