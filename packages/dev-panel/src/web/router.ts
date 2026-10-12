import {createRouter, createWebHistory} from "vue-router";

/** 路由与页面的对应见 docs/panel.md 的“前端”。页面按需加载：首页先出来，其余页面点到才取。 */
export const router = createRouter({
    history: createWebHistory(),
    routes: [
        {path: "/", name: "home", component: () => import("./pages/HomePage.vue")},
        {path: "/work/:workId", name: "work", component: () => import("./pages/WorkPage.vue"), props: true},
        {path: "/work/:workId/task/:taskId", name: "task", component: () => import("./pages/TaskPage.vue"), props: true},
        {path: "/:rest(.*)*", name: "missing", component: () => import("./pages/MissingPage.vue")},
    ],
});
