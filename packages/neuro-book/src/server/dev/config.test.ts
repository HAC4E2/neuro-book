import {describe, expect, it} from "bun:test";

import {DevConfigError, readDevConfig} from "./config";

describe("开发模式参数", () => {
    it("缺省页面 4217、RPC 4218、后端 4219 且成组顺延；显式给出任何一个就不顺延；只监听本机，状态根在包内 .dev-state；相对状态根按包目录解析", () => {
        expect(readDevConfig({}, "/pkg")).toEqual({host: "127.0.0.1", pagePort: 4217, backendPort: 4219, rpcPort: 4218, shiftPorts: true, stateRoot: "/pkg/.dev-state"});
        expect(readDevConfig({NBOOK_STATE_ROOT: "data", NBOOK_DEV_PORT: "0", NBOOK_DEV_BACKEND_PORT: "4001", NBOOK_DEV_RPC_PORT: "4002"}, "/pkg"))
            .toEqual({host: "127.0.0.1", pagePort: 0, backendPort: 4001, rpcPort: 4002, shiftPorts: false, stateRoot: "/pkg/data"});
        expect(readDevConfig({NBOOK_DEV_RPC_PORT: "4002"}, "/pkg")).toMatchObject({pagePort: 4217, backendPort: 4219, rpcPort: 4002, shiftPorts: false});
    });

    it("端口不是 0..65535 的整数时拒绝", () => {
        for (const value of ["-1", "65536", "3.5", "http"]) {
            expect(() => readDevConfig({NBOOK_DEV_PORT: value}, "/pkg")).toThrow(DevConfigError);
        }
    });
});
