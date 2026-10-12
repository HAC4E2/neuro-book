import {afterEach, describe, expect, test} from "bun:test";
import type {SessionCaller} from "../src/core/identity.js";
import {listLeases, releaseTaskLeases} from "../src/core/lease-ops.js";
import {setRecordStatus, setTaskStatus} from "../src/core/operations.js";
import {locateRepository} from "../src/core/repo.js";
import {readProjectStatus} from "../src/core/status.js";
import type {Warning} from "../src/core/errors.js";
import {cleanupFixtures, createFixture} from "./git-fixture.js";

afterEach(async () => {
    await cleanupFixtures();
});

const bob: SessionCaller = {kind: "session", ref: {key: "external:bob", agent: "external", sessionId: null, label: "bob", parentSessionId: null, nestedSessionId: null}, via: "as", process: null, herdr: null};

describe("租约释放的竞争", () => {
    test("释放晚到：A 改成 done 并提交，B 随即改回 active 并续期，A 的释放这时才执行，B 的租约保留", async () => {
        const fixture = await createFixture("lease-late-release");
        const context = await locateRepository(fixture.main);
        // setTaskStatus 内部先提交状态、再在锁外释放；这里把两步拆开，按审查复现的顺序交错。
        expect((await setRecordStatus(context, {workRef: "w00001", taskRef: "t01", status: "done"})).commit.committed).toBe(true);
        const reopened = await setTaskStatus(context, {workRef: "w00001", taskRef: "t01", status: "active"}, {caller: bob, herdr: null});
        expect(reopened.data.lease?.session.key).toBe("external:bob");

        const warnings: Warning[] = [];
        const released = await releaseTaskLeases(context, {workId: "w00001-seed", taskId: "t01-seed"}, "task_done", {caller: null, herdr: null}, warnings);
        expect(released).toEqual([]);
        expect(warnings.map((warning) => warning.code)).toEqual(["lease_release_skipped"]);
        expect((await listLeases(context, {all: true}, {herdr: null})).data.leases.map((lease) => [lease.session.key, lease.state])).toEqual([["external:bob", "valid"]]);
        const {status} = await readProjectStatus(context, {}, {herdr: null});
        expect(status.works[0]?.activeLeases.map((lease) => lease.sessionKey)).toEqual(["external:bob"]);
    });
});
