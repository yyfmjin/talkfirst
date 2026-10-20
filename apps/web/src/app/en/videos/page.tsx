import VideosPage from "../../videos/page";

/**
 * 视频流的英文入口。
 *
 * 这页是全屏播放器，中文侧也没有 `metadata`（标题用根布局的默认值），所以这里
 * 同样不额外导出 metadata。
 */
export default function VideosPageEn() {
  return <VideosPage />;
}
