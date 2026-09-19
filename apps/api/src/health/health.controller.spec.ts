import { HealthController } from "./health.controller";

jest.mock("@nestjs/common", () => ({
  Controller: () => () => undefined,
  Get: () => () => undefined,
}));

describe("HealthController", () => {
  it("returns a successful health payload", () => {
    const controller = new HealthController();
    const result = controller.check();

    expect(result.success).toBe(true);
    expect(result.data.status).toBe("ok");
    expect(result.data.service).toBe("talkfirst-api");
  });
});
