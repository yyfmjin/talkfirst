import { UsersService } from "./users.service";
import { normalizeUploadUrl } from "../uploads/upload-url";

describe("UsersService.updateAvatar persistence contract", () => {
  it("normalizes the avatar URL before persistence so read/write use one rule", async () => {
    const prisma = {
      user: {
        update: jest.fn().mockImplementation(async ({ data }: { data: { avatarUrl: string } }) => ({
          id: "user-1",
          avatarUrl: data.avatarUrl,
        })),
      },
      language: { findMany: jest.fn() },
      interest: { findMany: jest.fn() },
      purpose: { findMany: jest.fn() },
      country: { findMany: jest.fn() },
    };
    const service = new UsersService(prisma as never);
    const spy = jest.spyOn(service, "getFullCard").mockResolvedValue({ avatarUrl: "x" } as never);

    await service.updateAvatar(
      "user-1",
      normalizeUploadUrl(" https://cdn.example.com/avatars/user-1.png ") as string,
    );

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { avatarUrl: "https://cdn.example.com/avatars/user-1.png" },
    });
    expect(spy).toHaveBeenCalledWith("user-1");
  });

  it("does not persist invalid avatar URLs", async () => {
    const prisma = {
      user: { update: jest.fn() },
    };
    const service = new UsersService(prisma as never);
    await expect(service.updateAvatar("user-1", "data:image/png;base64,abcd")).rejects.toMatchObject({
      code: "INVALID_IMAGE",
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
