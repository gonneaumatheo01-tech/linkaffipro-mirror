import { describe, expect, it } from "vitest";
import { Api, helpers } from "telegram";
import { adminChannelFromEntity } from "./client";

const bigInt = helpers.returnBigInt;

function channel(over: Partial<ConstructorParameters<typeof Api.Channel>[0]> = {}) {
  return new Api.Channel({ id: bigInt(123456), title: "Mon canal", photo: new Api.ChatPhotoEmpty(), date: 0, ...over });
}

describe("adminChannelFromEntity", () => {
  it("retient un canal dont le compte est créateur", () => {
    expect(adminChannelFromEntity(channel({ creator: true, broadcast: true, username: "moncanal", participantsCount: 42 }))).toEqual({
      telegramChatId: "-100123456",
      title: "Mon canal",
      username: "moncanal",
      isCreator: true,
      isAdmin: true,
      isBroadcast: true,
      memberCount: 42,
    });
  });
  it("retient un supergroupe où le compte est administrateur", () => {
    const c = adminChannelFromEntity(channel({ megagroup: true, adminRights: new Api.ChatAdminRights({ postMessages: true }) }));
    expect(c).toMatchObject({ isCreator: false, isAdmin: true, isBroadcast: false, username: null, memberCount: null });
  });
  it("ignore un canal où le compte est simple membre, et les autres entités", () => {
    expect(adminChannelFromEntity(channel({ broadcast: true }))).toBeNull();
    expect(adminChannelFromEntity(new Api.User({ id: bigInt(1) }))).toBeNull();
    expect(adminChannelFromEntity(undefined)).toBeNull();
  });
});
