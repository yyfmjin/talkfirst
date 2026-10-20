import UserMomentsPage from "../../../../moments/user/[id]/page";

/**
 * 「某个成员的动态」页的英文入口。
 *
 * 这个页面本来就是纯客户端组件、中文侧也没有 `metadata`，所以这里同样不导出
 * metadata —— 与其编一个和页面内容不符的标题，不如沿用根布局的默认值。
 */
export default function UserMomentsPageEn() {
  return <UserMomentsPage />;
}
