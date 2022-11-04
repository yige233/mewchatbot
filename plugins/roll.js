import {
    MewPlugin
} from "../lib/mian.js";
import createLogger from "../lib/logger.js";

const logger = createLogger("Roll");
const _bot = Symbol("_bot");


class rollHandler extends MewPlugin {
    constructor() {
        super("roll", "message_handler");
    };
    interface(bot) {
        this[_bot] = bot;
    };
    async handleCommand(command) {
        const resultArray = [ //使用一个数组来记录抽取结果
            "抽取结果：",
        ];
        let [, thoughtId, rollCount = 1, isFilt = true] = command; //取出参数
        rollCount = typeof (rollCount) != "number" ? 1 : rollCount;
        if (thoughtId == "help" || !thoughtId) return `使用 /roll <想法id> <?抽取人数:默认为1> <?是否过滤单人多楼:默认启用> 来随机抽取帖子中的楼层；使用 /roll help 来查看本说明。`; //默认返回文字
        if (!await this.isThoughtExist(thoughtId)) return "无法获取想法信息，请检查想法id是否正确……"; //检查想法id
        let allFloor = await this.getAllFloor(thoughtId); //获取所有楼层
        if (allFloor.length == 0) return "这个贴子里没有可供抽取的楼层哦……"; //无可抽取楼层
        if (isFilt) allFloor = this.floorFilter(allFloor); //过滤单人多楼的情况
        if (allFloor.length < rollCount) return "传入的抽取人数大于可抽取楼层数，无法抽取……"; //楼层数小于欲抽取人数
        resultArray.push(`共计 ${allFloor.length} 个有效楼层，抽取了 ${rollCount} 楼，名单如下：\n`); //记录一些信息
        for (let result of this.roll(allFloor, rollCount)) { //获取抽取结果
            const userInfo = await this[_bot].reuqest(`https://api.mew.fun/api/v1/users/${result.author_id}`); //获取用户信息
            resultArray.push(`第${result.index}楼的 ${userInfo.data.name} @${userInfo.data.username}`); //记录抽取结果
        };
        return resultArray.join("\n"); //返回抽取结果
    };
    async isThoughtExist(thoughtId) {
        try {
            await this[_bot].reuqest(`https://api.mew.fun/api/v1/thoughts/${thoughtId}`);
            return true;
        } catch {
            return false;
        };
    };
    async getAllFloor(thoughtId) {
        let get100Floors = async (thoughtId, before = "") => { //获取100层楼的楼层
            const res = await this[_bot].reuqest(`https://api.mew.fun/api/v1/thoughts/${thoughtId}/comments?limit=100${before?"&before="+before:""}`);
            return res.data.entries;
        };
        const allFloor = []; //初始化所有楼层的数组
        let nextFloorId = "";
        while (true) { //循环获取楼层信息，一次100层
            const Floors100 = await get100Floors(thoughtId, nextFloorId);
            if (!Floors100.length) break; //获取到末尾了。跳出循环
            for (let floor of Floors100) {
                if (floor.deleted) continue; //检查楼层是否被删除
                allFloor.push({
                    author_id: floor.author_id,
                    id: floor.id,
                    index: floor.index
                });
            };
            nextFloorId = Floors100[Floors100.length - 1].id; //设置下次循环开始的楼层id
        };
        return allFloor;
    };
    floorFilter(floors) {
        const authorIdArray = []; //创建用于存储用户id的数组
        const newFloorArray = []; //新的楼层数组
        for (let floor of floors) {
            if (authorIdArray.includes(floor.author_id)) continue; //如果用户id数组内已经含有该用户，则跳过
            authorIdArray.push(floor.author_id);
            newFloorArray.push(floor);
        };
        return newFloorArray
    };
    roll(floors, rollCount) {
        const resultId = []; //存储抽取的id楼层
        const result = []; //存储结果
        while (result.length < rollCount) {
            let onceResult = floors[Math.floor((Math.random() * floors.length))]; //抽取
            if (resultId.includes(onceResult.id)) continue; //如果已经被抽取，则跳过
            resultId.push(onceResult.id);
            result.push(onceResult);
        };
        return result;
    };
    async handler(msg, command) {
        const message = await this.handleCommand(command);
        msg.reply({
            content: message
        });

    };
};
export default rollHandler;