# 安全政策 / Security Policy

## 私密报告漏洞 / Report Vulnerabilities Privately

如果你发现了可能影响 NeuroBook 用户、数据或运行环境的安全漏洞，请使用 [GitHub Private Vulnerability Reporting](https://github.com/notnotype/neuro-book/security/advisories/new) 私密提交报告。不要先创建公开 Issue、Discussion 或 Pull Request，也不要在公开聊天室披露复现细节。

If you discover a vulnerability that may affect NeuroBook users, data, or runtime environments, report it through [GitHub Private Vulnerability Reporting](https://github.com/notnotype/neuro-book/security/advisories/new). Do not first open a public issue, discussion, or pull request, and do not disclose reproduction details in public chat.

安全问题包括但不限于：鉴权绕过、任意文件读写、路径越界、远程代码执行、密钥或私人内容泄露、恶意包或备份导致的权限提升，以及能够跨用户或跨 Project Workspace 访问数据的缺陷。普通安装失败、性能问题和不包含安全影响的 Bug 请使用公开 Issue 表单。

Examples include authentication bypasses, arbitrary file access, path traversal, remote code execution, secret or private-content disclosure, privilege escalation through a malicious package or backup, and access across users or Project Workspaces. Use the public issue forms for ordinary installation failures, performance problems, and bugs without a security impact.

## 报告内容 / What to Include

请尽量提供：

- 受影响的版本、commit 或 Release；
- 操作系统、CPU 架构和安装方式；
- 漏洞影响、攻击前提和可能受影响的数据；
- 可以重复的最小步骤；
- 已脱敏的日志、截图或概念验证；
- 你是否已经在其它地方披露该问题。

Please include, when possible:

- the affected version, commit, or release;
- the operating system, CPU architecture, and installation method;
- impact, prerequisites, and data that may be exposed;
- minimal repeatable steps;
- redacted logs, screenshots, or proof of concept;
- whether the issue has been disclosed elsewhere.

不要在报告中提供真实 API Key、访问令牌、小说正文、私人会话或不必要的个人数据。请使用最小化的测试账户和合成数据。

Do not include real API keys, access tokens, manuscripts, private sessions, or unnecessary personal data. Use minimal test accounts and synthetic data.

## 支持范围 / Supported Versions

安全修复面向当前 `master` 和最新公开版本。旧版本通常需要先升级到最新版本才能获得修复；仓库目前不承诺为每条历史发布线单独提供补丁。

Security fixes target current `master` and the latest public release. Older versions will usually need to upgrade to receive a fix; the project does not currently promise separate patches for every historical release line.

## 协调与披露 / Coordination and Disclosure

维护者会在可用时通过私密报告线程确认问题、请求补充材料并协调修复和公开时间。请在双方商定时间前保持漏洞私密。项目当前不承诺固定响应时限、漏洞赏金或奖金；提交高质量报告也不自动形成付款或雇佣关系。

Maintainers will use the private report thread, when available, to confirm the issue, request details, and coordinate remediation and disclosure. Keep the vulnerability private until an agreed disclosure time. The project does not currently promise a fixed response SLA, bug bounty, or reward; a high-quality report does not create a payment or employment relationship.
