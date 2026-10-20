/**
 * 「请求联系方式」面板的英文入口。
 *
 * 直接把中文那棵树里的路由组件原样导出：它自己就是客户端组件，接收的是
 * `params: Promise<{ id }>`，包一层再转发反而多一个要维护的 prop 类型。
 *
 * 不导出 `metadata`：地址里带会话 id，静态 metadata 取不到具体值（理由见
 * `en/moments/[id]/page.tsx`），而中文侧这一页本身也没有 metadata。
 */
export { default } from "../../../../messages/[id]/connect/page";
