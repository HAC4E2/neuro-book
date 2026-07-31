import {describe, expect, it} from "vitest";
import {
    reduceProjectCoverRecovery,
    settleProjectCoverRecoverySnapshot,
    type ProjectCoverRecoveryState,
} from "nbook/app/utils/project-cover-recovery";
import type {ProjectMetadataDto} from "nbook/shared/dto/project.dto";

describe("Project cover recovery state", () => {
    it("按 Project 隔离提交未知和刷新错误，单个更新不会覆盖其它 Project", () => {
        let state: ProjectCoverRecoveryState = new Map();
        state = reduceProjectCoverRecovery(state, {
            type: "begin",
            projectRoot: "book-a",
            commitState: "unknown",
        });
        state = reduceProjectCoverRecovery(state, {
            type: "failure",
            projectRoot: "book-a",
            error: "network down",
        });
        state = reduceProjectCoverRecovery(state, {
            type: "begin",
            projectRoot: "book-b",
            commitState: true,
        });

        expect(state.get("book-a")).toEqual({commitState: "unknown", error: "network down"});
        expect(state.get("book-b")).toEqual({commitState: true, error: ""});
    });

    it("完整 Project snapshot 成功后一次清除全部恢复门禁", () => {
        const state = reduceProjectCoverRecovery(new Map(), {
            type: "begin",
            projectRoot: "book-a",
            commitState: "unknown",
        });

        expect(reduceProjectCoverRecovery(state, {type: "clear-all"}).size).toBe(0);
    });

    it("完整 snapshot 一次清除两本书并结算当前 unknown Project", () => {
        let state: ProjectCoverRecoveryState = new Map();
        state = reduceProjectCoverRecovery(state, {type: "begin", projectRoot: "book-a", commitState: true});
        state = reduceProjectCoverRecovery(state, {type: "begin", projectRoot: "book-b", commitState: "unknown"});

        const settlement = settleProjectCoverRecoverySnapshot({
            state,
            projects: [project("book-a"), project("book-b")],
            requestedProjectRoot: "book-b",
            activeProjectRoot: "book-b",
        });

        expect(settlement.state.size).toBe(0);
        expect(settlement.cacheBustRoots).toEqual(["book-a", "book-b"]);
        expect(settlement.focused).toEqual({kind: "unknown", project: project("book-b")});
    });

    it("区分 committed、Project missing 与迟到刷新", () => {
        const committedState = reduceProjectCoverRecovery(new Map(), {
            type: "begin",
            projectRoot: "book-a",
            commitState: true,
        });

        expect(settleProjectCoverRecoverySnapshot({
            state: committedState,
            projects: [project("book-a")],
            requestedProjectRoot: "book-a",
            activeProjectRoot: "book-a",
        }).focused).toEqual({kind: "committed", project: project("book-a")});

        expect(settleProjectCoverRecoverySnapshot({
            state: committedState,
            projects: [],
            requestedProjectRoot: "book-a",
            activeProjectRoot: "book-a",
        }).focused).toEqual({kind: "missing", projectRoot: "book-a"});

        expect(settleProjectCoverRecoverySnapshot({
            state: committedState,
            projects: [project("book-a"), project("book-b")],
            requestedProjectRoot: "book-a",
            activeProjectRoot: "book-b",
        })).toEqual({
            state: new Map(),
            cacheBustRoots: ["book-a"],
            focused: {kind: "none"},
        });
    });

    it("没有匹配恢复记录时不产生 Dialog 结算或 cache bust", () => {
        expect(settleProjectCoverRecoverySnapshot({
            state: new Map(),
            projects: [project("book-a")],
            requestedProjectRoot: "book-a",
            activeProjectRoot: "book-a",
        })).toEqual({
            state: new Map(),
            cacheBustRoots: [],
            focused: {kind: "none"},
        });
    });
});

/** 建立只包含恢复状态机所需字段的 Project snapshot 项。 */
function project(projectRoot: string): ProjectMetadataDto {
    return {
        projectRoot,
        kind: "novel",
        title: projectRoot,
        summary: "",
    };
}
