# 起名网（灵游空间）前端改动镜像

## 这是什么

起名网是**独立部署**的应用：源码在服务器 `/opt/bazi`，用 Docker（bun）构建，
挂在 `https://talkfirst.ccwu.cc/bazi/`。它不在本 monorepo 的构建链里。

这里只放**我们改过的那几个文件**，为的是不把改动只留在服务器上（服务器重建、
换机器时会丢）。完整的应用仍然以 `/opt/bazi` 为准。

## 本轮（2026-11-08）改了什么

`client/src/App.tsx`
- 主导航：8 个胶囊平铺 → **4 个主入口 + 「更多」**（今日 / 命盘 / 合盘 / 消息 + 候选 / 好友 / 关系 / 账号）。
  选中「更多」里的某项时，按钮显示那一项的名字。
- 账号面板：从 TalkFirst 单点登录进来的会话（`localStorage["bazi.tfLinked"]`），
  不再显示「改密码 / 注销」——那是第二套账号，正是运营说的「串线」；
  改为一句说明，指回 TalkFirst App 的「我的」。

`client/src/i18n.tsx`
- 新增 `tabMore`、`tfAccountManaged` 两条文案（中英）。

## 怎么发布

见 `docs/BAZI-STANDALONE.md`：把改过的文件 `scp` 到 `/opt/bazi/client/src/`，
`docker build` 新镜像，`docker rm -f bazi-app` 后用**同样的环境变量**
（尤其是 `BAZI_SERVICE_SECRET`）重新 `docker run`。

## 2026-11-10 第二轮

`client/src/App.tsx`
- 账号：访客的「登录 / 注册」表单整块撤掉，换成「账号由 TalkFirst 统一管理」说明卡；
  账号页显示从 TalkFirst 同步来的昵称与头像。
- 导航仍是 4 + 「更多」（上一轮）。

`server/src/actions.ts` / `schema.ts` / `standalone.ts`
- `register` / `login` 两个动作直接返回「请从 TalkFirst 打开」，不再产生本地账号。
- SSO 登录时同步 TalkFirst 的 nickname / email / avatarUrl / birthDate / gender，
  每次登录覆盖刷新（以 TalkFirst 为准）；启动时幂等补列，不需要手工迁移。

`server/src/naming.ts`
- 字库 80 → 100 字（每个五行补 3–8 个常用字，含拼音、声调、笔画、字义、寓意），
  仍坚持「不编典故」：只写字义与寓意短语。

## 待办

- 把整个 `client/` 与 `server/` 纳入本仓库并接上 CI，才有真正的 code review；
  当前这种「服务器上直接改」的方式只能算过渡。
- 字库还想要更大：目前 100 字，做「备选字库」章节够用，但离"每个五行 24 字"还有距离。
