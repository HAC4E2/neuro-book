import {createRouter, createWebHistory} from "vue-router";

declare module "vue-router" {
    interface RouteMeta {
        /**
         * 页面怎么用外壳给的高度（t15）：缺省“流式”，`main` 竖向滚动；“铺满”时 `main` 不滚，页面占满高度、由它的分栏各自滚动。
         * 一页只有一个竖向滚动者，见 docs/panel.md 的“前端”。
         */
        layout?: "flow" | "fill";
    }
}

/** 路由与页面的对应见 docs/panel.md 的“前端”。页面按需加载：首页先出来，其余页面点到才取。 */
export const router = createRouter({
    history: createWebHistory(),
    routes: [
        {path: "/", name: "home", component: () => import("./pages/HomePage.vue")},
        {path: "/work/:workId", name: "work", component: () => import("./pages/WorkPage.vue"), props: true},
        {path: "/work/:workId/task/:taskId", name: "task", component: () => import("./pages/TaskPage.vue"), props: true},
        {path: "/artifacts", name: "artifacts", component: () => import("./pages/ArtifactsPage.vue")},
        {path: "/artifact/:workId/:taskId/:artifactId", name: "artifact", component: () => import("./pages/ArtifactPage.vue"), props: true},
        {path: "/docs", name: "docs", component: () => import("./pages/DocsPage.vue"), meta: {layout: "fill"}},
        {path: "/live/sessions", name: "sessions", component: () => import("./pages/SessionsPage.vue")},
        {path: "/live/checkouts", name: "checkouts", component: () => import("./pages/CheckoutsPage.vue")},
        {path: "/live/runs", name: "runs", component: () => import("./pages/RunsPage.vue")},
        {path: "/live/github", name: "github", component: () => import("./pages/GithubPage.vue")},
        {path: "/search", name: "search", component: () => import("./pages/SearchPage.vue")},
        {path: "/new", name: "new", component: () => import("./pages/NewPage.vue")},
        {path: "/edit", name: "edit", component: () => import("./pages/EditPage.vue")},
        {path: "/:rest(.*)*", name: "missing", component: () => import("./pages/MissingPage.vue")},
    ],
});
