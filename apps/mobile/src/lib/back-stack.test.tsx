import { useState, type ReactElement } from "react";
import renderer, { act } from "react-test-renderer";
import { handleHardwareBack, resetBackHandlers, useBackHandler } from "./back-stack";

/*
 * 这组用例盯的是 2026-10-15 运营方反馈的那个具体毛病：
 * 「有些界面点开后返回不了上一页，返回会直接退出 app」——
 * 子页面是全屏接管状态、没有路由栈，系统返回键没人接管。
 */

/** 一个最小的子页：`active` 就是「有没有打开」。 */
function Overlay({ active, onBack }: { active: boolean; onBack: () => void }) {
  useBackHandler(active, onBack);
  return null;
}

/**
 * 模拟真实的两层结构（外层页自己注册 + 内层子页也注册）：
 * 按一下先关内层，再按一下才关外层。
 */
function TwoLayers() {
  const [outerOpen, setOuterOpen] = useState(true);
  const [innerOpen, setInnerOpen] = useState(true);
  useBackHandler(outerOpen, () => {
    setInnerOpen(false);
    setOuterOpen(false);
  });
  useBackHandler(innerOpen, () => setInnerOpen(false));
  return null;
}

async function mount(node: ReactElement) {
  let tree: renderer.ReactTestRenderer | null = null;
  await act(async () => {
    tree = renderer.create(node);
  });
  return tree as unknown as renderer.ReactTestRenderer;
}

describe("系统返回键接管栈", () => {
  beforeEach(() => {
    resetBackHandlers();
  });

  it("没有任何子页接管时返回 false（交回系统，等于退出 app）", () => {
    expect(handleHardwareBack()).toBe(false);
  });

  it("子页打开时由它接管，并执行它的关闭动作", async () => {
    const onBack = jest.fn();
    const tree = await mount(<Overlay active onBack={onBack} />);

    expect(handleHardwareBack()).toBe(true);
    expect(onBack).toHaveBeenCalledTimes(1);

    await act(async () => tree.unmount());
  });

  it("没打开的子页不接管（active=false 时不抢返回键）", async () => {
    const onBack = jest.fn();
    const tree = await mount(<Overlay active={false} onBack={onBack} />);

    expect(handleHardwareBack()).toBe(false);
    expect(onBack).not.toHaveBeenCalled();

    await act(async () => tree.unmount());
  });

  it("关掉子页之后又回到「没人接管」", async () => {
    const onBack = jest.fn();
    const tree = await mount(<Overlay active onBack={onBack} />);
    expect(handleHardwareBack()).toBe(true);

    await act(async () => {
      tree.update(<Overlay active={false} onBack={onBack} />);
    });
    expect(handleHardwareBack()).toBe(false);

    await act(async () => tree.unmount());
  });

  it("嵌套时先关最上面那层，再关下一层，全关完才是退出", async () => {
    const tree = await mount(<TwoLayers />);

    /* 第一下：里层被关掉。 */
    expect(handleHardwareBack()).toBe(true);
    /* 让 React 处理这次状态更新（真实设备上两次按键之间自然会间隔开）。 */
    await act(async () => {});

    /* 第二下：外层还在，仍然拦得住。 */
    expect(handleHardwareBack()).toBe(true);
    await act(async () => {});

    /* 第三下：都关完了 —— 这才是「退出 app」。 */
    expect(handleHardwareBack()).toBe(false);

    await act(async () => tree.unmount());
  });

  it("handler 每次渲染都是新闭包，但拿到的是最新的那个", async () => {
    const first = jest.fn();
    const second = jest.fn();
    const tree = await mount(<Overlay active onBack={first} />);

    /* 模拟「父级重新渲染、回调换成新的」：注册不该因此断掉或变旧。 */
    await act(async () => {
      tree.update(<Overlay active onBack={second} />);
    });

    expect(handleHardwareBack()).toBe(true);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    await act(async () => tree.unmount());
  });
});
