import WebSocket from "ws";
import fetch from "node-fetch";
import crypto from "crypto-js";
import crc from "crc";
import createLogger from "./logger.js";


const logger = createLogger("Main"),
    mw_events = Symbol("mw_events"),
    mw_ws = Symbol("mw_WebSocket"),
    mw_user = Symbol("mw_user"),
    mw_token = Symbol("mw_token"),
    mw_status = Symbol("mw_status"),
    mw_plugins = Symbol("mw_plugins"),
    mw_timer = Symbol("mw_timer"),
    mw_hbcount = Symbol("mw_hbcount"),
    mimgup_token = Symbol("mimgup_token"),
    mimgup_sts = Symbol("mimgup_sts"),
    mt_doc = Symbol("mt_doc"),
    mt_thought = Symbol("mt_thought"),
    mp_id = Symbol("mp_id"),
    mp_require = Symbol("mp_require"),
    events = Symbol("events");

class Events {
    /**
     * @desc 一个事件类，用来触发各种事件
     */
    constructor() {
        this[events] = new Map([ //全部的事件列表
            ["user_update", []],
            ["user_typing", []],
            ["user_relationship_update", []],
            ["node_create", []],
            ["node_update", []],
            ["node_delete", []],
            ["node_position", []],
            ["node_topic_space_position_change", []],
            ["topic_create", []],
            ["topic_update", []],
            ["topic_delete", []],
            ["topic_position", []],
            ["role_create", []],
            ["role_update", []],
            ["role_delete", []],
            ["role_position", []],
            ["node_member_add", []],
            ["node_member_update", []],
            ["node_member_remove", []],
            ["node_member_ban", []],
            ["node_member_activity_change", []],
            ["message_create", []],
            ["message_update", []],
            ["message_delete", []],
            ["message_engagement", []],
            ["message_acknowledge", []],
            ["thought_create", []],
            ["thought_update", []],
            ["thought_delete", []],
            ["thought_engagement", []],
            ["comment_engagement", []],
            ["comment_create", []],
            ["comment_update", []],
            ["comment_delete", []],
            ["notification", []],
            ["thought_pin", []],
            ["thought_unpin", []],
            ["app_update", []],
            ["heartbeat", []],
            ["status_change", []],
            ["default", [(data) => logger.warn(`未知事件：${data.eventName}`)]]
        ]);
    };
    /**
     * @desc 注册事件。只能注册预先定义的事件列表中存在的事件，否则会报错。
     * @param {string} eventName 事件名称
     * @param {function} callback 回调函数
     */
    on(eventName, callback) {
        if (!this[events].has(eventName) || eventName == "default") throw new Error("不能注册不存在的事件", eventName);
        this[events].get(eventName).push(callback);
    };
    /**
     * @desc 移除事件。只能移除预先定义的事件列表中存在的事件，否则会报错。
     * @param {string} eventName 事件名称
     * @param {function} callback 回调函数
     */
    remove(eventName, callback) {
        if (!this[events].has(eventName) || eventName == "default") throw new Error("不能移除不存在的事件", eventName);
        this[events].set(eventName, this[events].get(eventName).filter(e => e != callback));
    };
    /**
     * @desc 触发事件。只能触发预先定义的事件列表中存在的事件，否则会报警。
     * @param {string} eventName 事件名称
     * @param  {...any} value 向回调函数传入的参数。多个参数会被放在数组中; 单个参数会直接传入
     */
    async emit(eventName, ...value) {
        if (!this[events].has(eventName)) {
            return logger.warn("触发了不存在的事件：", eventName);
        };
        const actions = this[events].get(eventName);
        for (let order in actions) {
            try {
                await actions[order]((value.length > 1) ? value : value[0]);
            } catch (err) {
                logger.error("执行事件", eventName, "的第", order, "个绑定的方法时出现错误:", err);
            };
        };
    };
}

class MewImgUpload {
    /**
     * @param {string} token 用于上传图片的用户token
     */
    constructor(token) { //构造时传入token
        this[mimgup_token] = token;
        this[mimgup_sts] = {};
    };
    /**
     * @param {*} image  可以是图片的url，也可以是一个buffer.
     * @param {*} fileName  图片的名称，默认为url或者是 Object Buffer
     */
    async imgUpload(image, fileName = Buffer.isBuffer(image) ? "<Object Buffer>" : image) { //通过url或者图片二进制数据上传图片
        try {
            if (!image) throw {
                message: "没有提供可供上传的图片！"
            };
            const startAt = new Date();
            this[mimgup_sts] = await this.getSTS();
            const resImage = await this.getImage(image);
            const resApply = await this.applyImgUpload();
            await this.upload(resImage, resApply);
            const resCommit = await this.commitImgUpload(resApply)
            const result = await this.getImgInfo(resCommit);
            const completeAt = new Date();
            logger.info(`上传 ${fileName} 完成，耗时：${(completeAt-startAt)/1e3} s`);
            return {
                ok: true,
                message: "ok",
                data: result,
                extra: {
                    image: fileName,
                    startAt: startAt,
                    completeAt: completeAt
                }
            };
        } catch (err) {
            const error = {
                ok: false,
                message: err.message,
                data: err.data || null,
                extra: {
                    image: fileName
                }
            };
            logger.error(`上传图片时出现错误`, error);
            throw error;
        };
    };
    async getSTS() { //获取sts token
        const res = await fetch(`${this.api}/medias/image/STSToken`, { //获取STStoken，用于上传认证
            headers: {
                Authorization: `Bearer ${this[mimgup_token]}`,
            },
        });
        const json = await res.json();
        if (!res.ok) throw {
            message: "获取STS Token失败",
            data: json.message
        };
        return json;
    };
    async getImage(image) { //从url获取图片数据
        if (Buffer.isBuffer(image)) return image;
        try {
            const controller = new AbortController();
            const signal = controller.signal;
            setTimeout(() => controller.abort(), 60 * 1e3);
            const res = await fetch(image, {
                signal: signal
            });
            if (!res.ok) throw new Error(res.status + res.statusText);
            return await res.blob()
        } catch (err) {
            throw {
                message: `获取图片失败: ${err.message}`,
                data: null
            };
        };
    };
    async applyImgUpload() { //提交上传图片申请
        const options = {
            headers: {
                "x-date": this.time,
                "x-security-token": this[mimgup_sts].session_token,
            },
            method: "GET",
        };
        const queryStr = ["Action=ApplyImageUpload", `ServiceId=${this.data.serviceid}`, "Version=2018-08-01"];
        options.headers.authorization = this.authorization(options, queryStr);
        const res = await fetch(`https://imagex.volcengineapi.com/?${queryStr.join("&")}`, options);
        const json = await res.json();
        if (json.ResponseMetadata.Error) throw {
            message: "请求上传图片时出现错误：" + json.ResponseMetadata.Error.message,
            data: json
        };
        return json;
    };
    async upload(image, resApply) { //上传图片
        const crc32 = Buffer.isBuffer(image) ? crc.crc32(image).toString(16) : await image.arrayBuffer().then(ab => crc.crc32(ab).toString(16)); //获取crc32校验信息
        const res = await fetch(`https://${resApply.Result.UploadAddress.UploadHosts[0]}/${resApply.Result.UploadAddress.StoreInfos[0].StoreUri}`, {
            headers: {
                "content-crc32": crc32,
                authorization: resApply.Result.UploadAddress.StoreInfos[0].Auth,
            },
            method: 'PUT',
            body: image
        });
        const json = await res.json();
        if (json.error.code != 200) throw {
            message: "上传图片时出现错误：" + json.error.message,
            data: json
        };
        return json;
    };
    async commitImgUpload(resApply) { //提交合并图片申请
        const options = {
            headers: {
                "x-date": this.time,
                "x-security-token": this[mimgup_sts].session_token
            },
            method: "POST",
        };
        const queryStr = [
            "Action=CommitImageUpload",
            `ServiceId=${this.data.serviceid}`,
            `SessionKey=${encodeURIComponent(resApply.Result.UploadAddress.SessionKey)}`,
            "Version=2018-08-01"
        ];
        options.headers.authorization = this.authorization(options, queryStr);
        const res = await fetch(`https://imagex.volcengineapi.com/?${queryStr.join("&")}`, options);
        const json = await res.json();
        if (json.ResponseMetadata.Error) throw {
            message: "完成图片上传时出现错误：" + json.ResponseMetadata.Error.message,
            data: json
        };
        return json;
    };
    async getImgInfo(resCommit) { //获取图片信息
        const res = await fetch(`${this.api}/medias/image/${encodeURIComponent(resCommit.Result.Results[0].Uri)}`, {
            headers: {
                Authorization: `Bearer ${this[mimgup_token]}`,
            },
            method: "POST"
        });
        const json = await res.json();
        if (!res.ok) throw {
            message: "获取图片上传结果时出现错误：" + json.message,
            data: json
        };
        return json;
    }
    authorization(options, queryStr) { //创建Authorization头部
        let SignedHeaders = [];
        for (let i in options.headers) SignedHeaders.push(i.toLowerCase());
        return [
            `${this.data.algorithm} Credential=${this[mimgup_sts].access_key_id}/${this.credentialString}`,
            `SignedHeaders=${SignedHeaders.join(";")}`,
            `Signature=${this.signature(options, queryStr).toString()}`,
        ].join(", ");
    };
    signature(options, queryStr) { //使用签名密钥对待签字符串进行签名
        return crypto.HmacSHA256(this.stringToSign(options, queryStr), this.getsignedkey);
    };
    canonicalString(options, queryStr) { //创建规范请求
        return [
            options.method.toUpperCase(), //请求方法大写
            "/", //请求路径
            queryStr.sort().join("&"), //请求字符串，按ascii顺序排列。参数名和值还需要URI编码，这里省略了
            ((headers) => {
                var h = [];
                var sh = [];
                for (let i in headers) h.push([i.toLowerCase(), headers[i]]);
                h.sort();
                for (let x in h) sh.push(h[x].join(":"));
                return sh.join("\n") + "\n";
            })(options.headers), //参与签名的头部，头名称小写后按ascii排序，值不需要小写。还要去除值前后空格，值中多个连续空格用一个空格代替，这里省略了
            ((headers) => {
                var h = [];
                for (let i in headers) h.push(i.toLowerCase());
                return h.join(";")
            })(options.headers), //记录参与了签名的头部
            crypto.SHA256(""), //对body进行sha256，这里默认body为空
        ].join("\n");
    };
    stringToSign(options, queryStr) { //创建待签字符串
        return [
            this.data.algorithm, //签名算法
            this.time, //时间
            this.credentialString, //凭据
            crypto.SHA256(this.canonicalString(options, queryStr)).toString(), //规范请求的sha256
        ].join("\n");
    };
    get getsignedkey() { //计算派生签名密钥
        let i = crypto.HmacSHA256(this.date, this.data.prefix + this[mimgup_sts].secret_access_key); //用AWS4与原密钥的组合字符串加密日期
        let o = crypto.HmacSHA256(this.data.region, i); //用以上结果加密地区码
        let a = crypto.HmacSHA256(this.data.service, o); //用以上结果加密服务名
        return crypto.HmacSHA256(this.data.v4Identifier, a); //用以上结果加密“request”;
    };
    get credentialString() {
        return [this.date, this.data.region, this.data.service, this.data.v4Identifier].join("/");
    };
    get date() {
        return this.time.slice(0, 8);
    };
    get time() {
        return new Date().toISOString().replace(/\.\d{3}Z$/, "Z").replace(/[:|-]/g, "");
    };
    get api() {
        return "https://api.mew.fun/api/v1"
    };
    get data() {
        return {
            serviceid: "c226mjqywu",
            version: "2018-08-01",
            region: "cn-north-1",
            service: "imagex",
            v4Identifier: "request",
            prefix: "",
            algorithm: "HMAC-SHA256",
        }
    };
};

class MewThought {
    constructor() {
        this[mt_doc] = {
            type: "doc",
            content: [],
            version: 2,
        };
        this[mt_thought] = {
            status: null,
            post: {
                content: null,
                media: [],
                embeds: [],
                cover: null,
            },
        };
    };
    get api() {
        return "https://api.mew.fun/api/v1";
    };
    get body() { //获取完整的上传数据
        this[mt_thought].post.content = JSON.stringify(this[mt_doc]);
        return this[mt_thought];
    };
    get title() {
        return this[mt_thought].status;
    }
    /**
     * @desc 定义一般段落。
     * @param {string} align 可选left（默认）、center、right
     */
    defPara(align = "left") {
        const para = Symbol("para");
        return new class {
            constructor(align) {
                this[para] = {
                    type: "paragraph",
                    attrs: {
                        textAlign: (["right", "center"].includes(align)) ? align : "left"
                    },
                    content: []
                };
            };
            /**
             * @desc 向段落内添加文字
             * @param {string} text 欲添加的文字
             * @param {string} styles (可选)样式,有 bold, italic, strike, code, link 。欲添加多个样式，应传入包含多个样式代码的数组
             * @param {string} href (可选)样式为link时，此参数指定链接url，否则使用text
             */
            addText(text = "", styles, href = text) { //向已定义的段落内添加文字。样式有粗体、斜体、删除线、代码、链接五种。样式为链接时，可以添加第三个参数指定超链接，否则使用text作为超链接
                let marks = [];
                for (let i of Array.isArray(styles) ? styles : [styles]) {
                    let style = (["bold", "italic", "strike", "code", "link"].includes(i)) ? {
                        type: i,
                        attrs: (i == "link") ? {
                            href: href,
                            target: "_blank",
                            "data-type": "inline",
                            title: text
                        } : null
                    } : {};
                    if (!style.attrs) delete style.attrs;
                    marks.push(style);
                };
                let obj = {
                    type: 'text',
                    marks: marks,
                    text: text
                };
                if (JSON.stringify(obj.marks) == "[{}]") delete obj.marks;
                this[para].content.push(obj);
                return this;
            };
            /**
             * @desc 将段落对象格式化为json。停止向段落添加文字后，务必调用。
             */
            done() {
                return this[para];
            };
        }(align);
    };
    /**
     * @desc 定义富文本块对象
     * @param {string} type 可选 ordered_list （有序列表）, blockquote （引用）, bullet_list （无序列表，默认）
     */
    defRichText(type = "bullet_list") {
        const _type = Symbol("_type");
        const richtext = Symbol("richtext");
        return new class {
            constructor(type) {
                this[_type] = (["blockquote", "ordered_list"].includes(type)) ? type : "bullet_list";
                this[richtext] = {
                    attrs: (["ordered_list"].includes(type)) ? {
                        start: 1
                    } : {},
                    type: this[_type],
                    content: [],
                };
                if (JSON.stringify(this[richtext].attrs) == "{}") delete this[richtext].attrs;
            };
            /**
             * @desc 添加一个或多个段落对象。仅当type为 ordered_list 或 bullet_list 时才应调用此方法。
             * @param {...paras} paras 一个或多个段落对象。
             */
            addListItem(...paras) {
                if (["ordered_list", "bullet_list"].includes(this[_type])) {
                    let item = {
                        type: "list_item",
                        content: []
                    };
                    for (let para of paras) item.content.push(para);
                    this[richtext].content.push(item);
                }
                return this;
            };
            /**
             * @desc 添加一个或多个段落对象。仅当type为 blockquote 时才应调用此方法。
             * @param {...paras} paras 一个或多个段落对象。
             */
            addQuoteItem(...paras) {
                if (["blockquote"].includes(this[_type])) {
                    for (let para of Array.isArray(paras) ? paras : [paras]) this[richtext].content.push(para);
                };
                return this;
            };
            /**
             * @desc 将富文本块对象格式化为json。停止向富文本块内添加文字后，务必调用。
             */
            done() {
                return this[richtext];
            };
        }(type);
    };
    /**
     * @desc 添加代码块
     * @param {string} lang 指定代码块使用的语言
     * @param  {...any} codes 代码文字
     */
    addCode(lang, ...codes) { //添加代码块，包含代码文字的数组和代码语言。
        let code_block = {
            type: "code_block",
            attrs: {
                language: (["java", "cpp", "pyhton", "javascript"].includes(lang)) ? lang : null
            },
            content: []
        };
        for (let code of codes) code_block.content.push({
            type: "text",
            text: code
        });
        this[mt_doc].content.push(code_block);
        return this;
    };
    /**
     * @desc  添加一个或多个段落对象
     * @param  {...any} blocks 一个或多个段落对象
     */
    addBlock(...blocks) { //添加段落对象和富文本对象。
        for (let block of blocks) this[mt_doc].content.push(block);
        return this;
    };
    /**
     * @desc 添加换行
     */
    addBreak() {
        this[mt_doc].content.push({
            type: "paragraph",
            attrs: {
                textAlign: "left"
            }
        });
        return this;
    };
    /**
     * @desc 添加分割线
     */
    addLine() {
        this[mt_doc].content.push({
            type: "horizontal_rule"
        });
        return this;
    };
    /**
     * @desc  添加标题文字
     * @param {string} content 标题文字
     * @param {number} level (可选)标题等级。可用 1 2 3级，默认1级
     * @param {string} align (可选)对齐方式。可用 left, center, right, 默认left
     */
    addHead(content = "", level = 1, align = "left") { //添加粗体文字，可用1、2、3级，可选3种对齐方式。
        this[mt_doc].content.push({
            type: "heading",
            attrs: {
                level: ([1, 2, 3].includes(level)) ? level : 1,
                textAlign: align = (["center", "right"].includes(align)) ? align : "left"
            },
            content: [{
                type: "text",
                text: content,
            }, ],
        });
        return this;
    };
    /**
     * @desc 添加链接卡片
     * @param {string} url 链接
     * @param {string} token 创建链接卡片要用到的用户token
     */
    async addPrettyLink(url, token) { //添加更好的链接。是异步函数，需要独立于调用链外使用。
        try {
            const res = await fetch(`${this.api}/embeds`, {
                headers: {
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json",
                },
                body: JSON.stringify({
                    url: url,
                }),
                method: "post",
            });
            const json = await res.json();
            if (!res.ok || !json.url) throw {
                message: "解析链接失败！",
                data: json
            };
            this[mt_doc].content.push({
                type: "embed_block",
                attrs: {
                    embedType: "link",
                    type: null,
                    id: json.id,
                },
            });
            this[mt_thought].post.embeds.push(json.id);
            return {
                ok: true,
                message: "ok",
                data: json,
                extra: {
                    url: url
                }
            };
        } catch (err) {
            const error = {
                ok: false,
                message: err.message,
                data: err.data || null,
                extra: {
                    url: url
                }
            };
            logger.error(`解析链接时出现错误:`, error);
            throw error;
        };
    };
    /**
     * @desc 添加图片
     * @param {string} id 图片id
     * @param {string} size (可选)图片尺寸。有 small, large (默认)。
     * @param {string} align (可选)对齐方式，有 left, right, center (默认)
     */
    addImg(id, size = "large", align = "center") { //添加图片，传入mew图片id，可选图片尺寸和对齐。
        this[mt_doc].content.push({
            type: "image_block",
            attrs: {
                id: id,
                size: (["small", "medium"].includes(size)) ? size : "large",
                align: (["left", "right"].includes(align)) ? align : "center"
            },
        });
        this[mt_thought].post.media.push(id);
        return this;
    };
    /**
     * @desc 添加封面
     * @param {string} id mew图片id
     */
    addCover(id) {
        this[mt_thought].post.cover = id;
        return this;
    };
    /**
     * @desc 添加标题文字
     * @param {string} text 标题文字
     */
    addTitle(text) { //添加标题文字
        this[mt_thought].status = (text.length > 800) ? `${text.slice(0, 796)}...` : text;
        return this;
    };
    /**
     * @desc 从已存在的帖子复制数据，仅支持长文类型
     * @param {string} thoughtId 帖子id
     * @param {string} token 用户登录凭据,私密据点中的帖子需要用到
     */
    async from(thoughtId, token) {
        const url = `https://api.mew.fun/api/v1/thoughts/${url}`;
        try {
            const res = await fetch(url, {
                headers: {
                    authorization: `Bearer ${token}`,
                    "content-type": "application/json",
                },
            });
            const json = await res.json();
            if (!res.ok) throw json;
            if (!json.post_content) throw {
                message: "没有在帖子中发现长文内容"
            };
            if (json.post_cover) this[mt_thought].post.cover = json.post_cover;
            if (json.status) this[mt_thought].post.cover = json.status;
            for (let block of JSON.parse(json.post_content).content) this[mt_doc].content.push(block);
            for (let image of json.post_media) this[mt_thought].post.media.push(image);
            for (let embeds of json.post_embeds) this[mt_thought].post.embeds.push(embeds);
            return {
                ok: true,
                message: "OK",
                data: null
            };
        } catch (err) {
            const error = {
                ok: false,
                message: err.message,
                data: thoughtId,
            };
            logger.error(`解析想法链接时出现错误:`, error);
            throw error;
        };
    };
};

class MewChatbot {
    constructor(token) { //构造时传入登录token
        this[mw_events] = new Events();
        this[mw_token] = token || null;
        this[mw_hbcount] = 0;
        this[mw_plugins] = [];
        this[mw_timer] = {
            hb: 0,
            connecting: 0,
            auth: 0,
        };
        this.setStatus("init");
        setInterval(() => {
            this[mw_events].emit("heartbeat");
        }, 5000);
    };
    get token() { //获取bot的登录token
        return this[mw_token];
    };
    get readyState() { //获取bot与mew服务器之间的连接状态
        return this[mw_ws].readyState;
    };
    get user() { //获取用户信息
        return this[mw_user] || {};
    };
    get status() { //获取bot状态
        return this[mw_status];
    };
    get url() { //获取bot与mew服务器间的websocket url
        return "wss://gateway.mew.fun/socket.io/?EIO=4&transport=websocket";
    };
    get api() { //返回mew的pi前缀。
        return "https://api.mew.fun/api/v1";
    };
    setStatus(status) { //为bot设置状态。这会触发 status_change 事件。该事件的回调函数会传入设置的状态。
        if (!status || status == this.status) return false;
        this[mw_status] = status;
        this[mw_events].emit("status_change", this.status);
        return true;
    };
    startWS(callbackfn) { //启动bot，传入回调函数，回调函数将于bot启动成功后执行
        if (["connecting", "online", "authorize", "error"].includes(this.status)) return;
        var ws = new WebSocket(this.url);
        let heartbeat = () => {
            clearTimeout(this[mw_timer].hb);
            this[mw_timer].hb = setTimeout(() => this.stopWS("心跳信号连接超时"), 40 * 1000);
            this.setStatus("online");
        };
        ws.addEventListener("message", (e) => {
            const code = e.data.match(/[0-9]{1,2}/).toString();
            const codeMap = new Map([
                ["0", (data) => {
                    //logger.info(`WS连接开始握手`, data);
                    this.setStatus("connecting");
                    clearTimeout(this[mw_timer].hb);
                    this[mw_timer].connecting = setTimeout(() => this.stopWS("握手信号连接超时"), 20 * 1000);
                    ws.send("40");
                }],
                ["2", (data) => {
                    //logger.info(`WS连接收到心跳包`, data);
                    heartbeat(true);
                    ws.send("3");
                }],
                ["40", (data) => {
                    //logger.info(`WS连接认证用户`, data);
                    this.setStatus("authorize");
                    clearTimeout(this[mw_timer].connecting);
                    this[mw_timer].auth = setTimeout(() => this.stopWS("身份认证连接超时"), 30 * 1000);
                    ws.send("420" + JSON.stringify(["identity", JSON.stringify({
                        token: this.token,
                        platform: "web",
                        active: true
                    })]));
                }],
                ["42", async (rawData) => {
                    let [type, data] = JSON.parse(rawData.slice(2));
                    let message = JSON.parse(data);
                    if (type == "identity") {
                        if (message.code) return ws.close(`4${message.code}`, message.error);
                        clearTimeout(this[mw_timer].auth);
                        heartbeat();
                        this[mw_user] = message.user;
                        callbackfn && callbackfn();
                    };
                    if (type == "dispatch") {
                        message.data.eventName = message.event;
                        const data_copy = Object.assign({}, message.data);
                        this[mw_events].emit(message.event, data_copy, Object.assign({}, message.data));
                    };
                }],
                ["default", (data) => logger.warn(`接收到未知的数据：`, data)],
            ]);
            (codeMap.get(code) || codeMap.get("default"))(e.data);
        });
        ws.addEventListener("error", (e) => {
            logger.error(`WS连接出现错误:`, e);
            this.setStatus("error");
        });
        ws.addEventListener("close", (e) => {
            logger.warn(`WS连接被关闭，状态码：${e.code}，原因：${e.reason||"无"}`);
            clearTimeout(this[mw_timer].hb);
            clearTimeout(this[mw_timer].connecting);
            clearTimeout(this[mw_timer].auth);
            this[mw_ws] = ws = null;
            this[mw_hbcount] = 0;
            this.setStatus("offline");
        });
        this[mw_ws] = ws;
    };
    stopWS(reason = "") { //关闭bot。传入一个布尔值用于控制是否自动重启
        this[mw_ws].close(4001, `manually closed: ${reason}`);
    };
    on(event, fn) { //监听websocket事件，并设置回调函数。传入事件名和回调函数。回调函数传入事件数据的副本data和原始事件数据的副本raw_data
        this[mw_events].on(event, fn);
    };
    remove(event, fn) { //移除监听websocket事件。传入事件名和回调函数
        this[mw_events].remove(event, fn);
    };
    async load(plugin) { //加载一个插件，返回加载成功与否
        if (this[mw_plugins].includes(plugin.id)) {
            logger.warn(`已经加载了同名的插件：${plugin.id}`);
            return false;
        };
        let load_status = true;
        if (plugin.require) {
            for (let i of plugin.require) {
                if (!this[mw_plugins].includes(i)) {
                    logger.warn(`插件 ${plugin.id} 需要前置插件 ${i}。`);
                    load_status = false;
                };
            };
        };
        try {
            if (load_status) {
                await plugin.interface(this);
                this[mw_plugins].push(plugin.id);
            }
        } catch (err) {
            logger.error(`插件 ${plugin.id} 加载失败！`, err);
            load_status = false;
        };
        return load_status;
    };
    reuqest(url, init) { //处理各种请求，用法同fetch。init中新增一个timeout属性，控制请求的超时时间。默认10s。s
        const controller = new AbortController();
        const signal = controller.signal;
        init = init || {};
        const timeout = init.timeout || 30 * 1000;
        const requestSignal = (init.signal && init.signal.aborted === false) ? init.signal : new AbortController().signal;
        if (init.body) {
            for (let i in init.body) {
                if (init.body[i] === null) delete init.body[i];
            };
        };
        return new Promise((resolve, reject) => {
            requestSignal.onabort = () => reject({
                ok: false,
                message: "请求被中止",
                data: null,
                extra: {
                    url: url,
                    init: JSON.stringify(init)
                }
            });
            fetch(url, {
                headers: Object.assign({
                    "authorization": `Bearer ${this.token}`,
                    "content-type": "application/json"
                }, init.headers || {}),
                method: init.method || "get",
                body: (init.body) ? JSON.stringify(init.body) : null,
                signal: signal
            }).then(async res => {
                if (!res.ok) return reject({
                    ok: false,
                    message: `${res.status} ${res.statusText}`,
                    data: await res.json(),
                    extra: {
                        url: url,
                        init: JSON.stringify(init)
                    }
                });
                resolve({
                    ok: true,
                    message: `${res.status} ${res.statusText}`,
                    data: (res.status == 200) ? await res.json() : null
                });
            }).catch(err => reject({
                ok: false,
                message: (err.name == "AbortError") ? "请求超时" : err.name,
                data: null,
                extra: {
                    url: url,
                    init: JSON.stringify(init)
                }
            }));
            setTimeout(() => controller.abort(), timeout);
        });
    };
    /**
     * @desc 启用http api, 允许通过http api控制bot （未完成
     * @param {string} key
     */
    httpApi(key) {
        const port = 5400;
    };
    postThought(thought, topic_id) { //发送一个想法。传入目标话题id、想法对象;
        return this.reuqest(topic_id ? `${this.api}/topics/${topic_id}/thoughts` : `${this.api}/users/@me/thoughts`, {
            body: thought.body,
            method: "post"
        });
    };
    repostThought(thought_id, topic_id, comment) { //转发想法。传入转发想法id、目标话题id、转发文字
        return this.reuqest(`${this.api}/topics/${topic_id}/quote/${thought_id}`, {
            body: {
                status: comment || ""
            },
            method: "post"
        });
    };
    deleteThought(thought_id) { //删除一个想法。传入目标想法id
        return this.reuqest(`${this.api}/thoughts/${thought_id}`, {
            method: "delete"
        });
    };
    moveThought(thought_id, topic_id) { //移动一个想法。传入想法id和目标话题id
        return this.reuqest(`${this.api}/thoughts/${thought_id}/move}`, {
            body: {
                topicId: topic_id
            },
            method: "patch"
        });
    };
    like(id, is_comment, is_del) { //点赞想法或评论。传入想法id或评论id、是否是评论id、是否取消点赞。即将弃用
        return this.reuqest(`${this.api}/users/@me/${is_comment?"comment-":""}likes/${id}`, {
            method: is_del ? "delete" : "put"
        });
    };
    follow(user_id, is_del) { //关注或取关用户。传入用户id、是否取关
        return this.reuqest(`${this.api}/users/@me/followings/${user_id}`, {
            method: is_del ? "delete" : "put"
        });
    };
    join(node_id, join_answer) { //加入据点。传入据点id、加入问题的回答
        return new Promise(async (resolve, reject) => {
            let [node_info_ok, node_info] = await this.reuqest(`${this.api}/nodes/${node_id}`).then(res => {
                if (res.data.enable_join_question && !join_answer) return [false, {
                    status: "Need answer",
                    message: res.data.join_questions[0].content
                }];
                return [true, res.data];
            }).catch(err => [false, err]);
            if (!node_info_ok) reject(node_info);
            try {
                let join = await this.reuqest(`${this.api}/${node_info.enable_join_question ? `users/@me/nodes/${node_info.id}/applications/join` : `nodes/${node_info.id}/join`}`, {
                    body: node_info.enable_join_question ? {
                        answers: [{
                            questionId: node_info.join_questions[0].id,
                            content: join_answer || ""
                        }]
                    } : null,
                    method: "post"
                });
                resolve(join.data);
            } catch (err) {
                reject(err)
            };
        })
    };
    leave(node_id) { //离开据点。传入据点id
        return this.reuqest(`${this.api}/users/@me/nodes/${node_id}`, {
            method: "delete"
        });
    };
    collection(thought_id, is_del) { //取消收藏想法。传入想法id
        return this.reuqest(`${this.api}/users/@me/bookmarks/${thought_id}`, {
            method: is_del ? "delete" : "put"
        });
    };
    sendMsg(topic_id, message) { //发送一条消息。目标话题id、消息对象
        function nonce_gen(len) {
            let nonce = [];
            for (let i = 0; i < len; i++) nonce.push(Math.floor(Math.random() * 10))
            return nonce.join("");
        };
        return new Promise((resolve, reject) => {
            if (!topic_id || !message) return reject({
                status: "Incomplete parameters"
            });
            let body = {
                nonce: message.content ? nonce_gen(18) : null,
                content: message.content || null,
                stamp: message.stamp || null,
                media: message.media || null,
                thought: message.thought || null,
                type: message.thought ? 2 : null,
            };
            for (let k in body) {
                if (body[k] == null) delete body[k];
            };
            if (body.content && body.content.length >= 2000) return reject({
                status: "Message too large"
            });
            this.reuqest(`${this.api}/topics/${topic_id}/messages`, {
                body: body,
                method: "post",
            }).then(res => {
                resolve(res.data);
                logger.info(`发送消息:`, [body, topic_id]);
            }).catch(err => reject(err));
        });
    };
    getPrivateTopicId(user_id) { //获取与指定用户私聊时使用的话题id
        return this.reuqest(`${this.api}/users/@me/directs/${user_id}`);
    };
    deleteMsg(message_id) { //删除一条消息。传入消息id
        return this.reuqest(`${this.api}/messages/${message_id}`, {
            method: "delete"
        });
    };
    emotion(id, emotion, type, is_del) { //为想法、评论或消息添加情绪。传入目标想法id、情绪id、是否标记为删除
        return this.reuqest(`${this.api}/${["thoughts","messages","comments"].includes(type)?type:"thoughts"}/${id}/reaction/${emotion}`, {
            method: is_del ? "delete" : "post"
        });
    };
    postComment(thought_id, comment, comment_id) { //向想法发送一条评论。传入想法id、评论内容对象、目标评论id（回复评论）
        return this.reuqest(`${this.api}/thoughts/${thought_id}/comments`, {
            body: {
                content: comment.text || null,
                media: comment.media || null,
                parentId: comment_id || null
            },
            method: "post",
        });
    };
    deleteComment(comment_id) { //删除一条评论。传入评论id
        return this.reuqest(`${this.api}/comments/${comment_id}`, {
            method: "put",
        });
    };
    changeNickname(new_nickname) { //更改昵称。传入新昵称
        return this.reuqest(`${this.api}/users/@me`, {
            body: {
                name: new_nickname || this.user.name
            },
            method: "patch",
        });
    };
    typing(topic_id, times, wait) { //使bot进入打字状态。传入目标话题id、激活打字状态的次数(一次打字状态持续5s)和Promise resolve的延迟时间(s)。
        times = Number(times) || 1;
        wait = wait || times * 1;
        return new Promise((resolve) => {
            for (let i = 0; i < times; i++) {
                setTimeout(() => {
                    this.reuqest(`${this.api}/topics/${topic_id}/typing`, {
                        method: "post"
                    }).catch(err => err);
                }, i * 5000);
                setTimeout(() => resolve(true), wait * 1000);
            };
        });
    };
};

class MewPlugin {
    constructor(id = "default_plugin", ...require) { //自定义插件需要继承这个类，向super方法传入该插件的id和需要的前置插件
        this[mp_id] = id;
        this[mp_require] = require || [];
    };
    get id() { //获取插件id，一般不建议重写
        return this[mp_id];
    };
    get require() { //获取插件需要的前置插件，一般不建议重写
        return this[mp_require]
    };
    interface(bot) { //该方法会接收一个bot对象。该方法相当于初始化插件，重写时可以在里面写上自己想在加载时执行的语句。不建议自己调用
    };
    //可以添加更多的自定义属性和方法
};

export {
    MewChatbot,
    MewThought,
    MewImgUpload,
    MewPlugin
}
/**
 * 消息对象：用于回复消息。四个属性互斥。
 *  {
 *      content: string,字符串消息，长度不能超过2000个字符
 *      stamp: string:mew_stamp,表情消息，需要使用特定的值
 *      media: array:mew_id,图片消息，长度为1的数组，含有1个图片id
 *      thought: string:mew_id分享想法，使用想法id
 * }
 */