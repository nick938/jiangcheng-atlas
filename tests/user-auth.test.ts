/* oxlint-disable typescript/no-floating-promises */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fingerprintsMatch, hashPassword, passwordFingerprint, verifyPassword } from "@/lib/user-auth";

const secret = "test-secret-value";

describe("密码派生与校验", () => {
  test("哈希包含随机盐与迭代次数", async () => {
    const first = await hashPassword("correct horse", secret);
    const second = await hashPassword("correct horse", secret);

    assert.ok(first.passwordSalt);
    assert.equal(first.passwordSalt.length, 32);
    assert.equal(first.passwordIterations, 210_000);
    assert.notEqual(first.passwordSalt, second.passwordSalt);
    assert.notEqual(first.passwordHash, second.passwordHash);
  });

  test("正确密码通过、错误密码失败", async () => {
    const record = await hashPassword("correct horse", secret);

    const accepted = await verifyPassword({
      username: "rider",
      password: "correct horse",
      secret,
      expectedHash: record.passwordHash,
      salt: record.passwordSalt,
      iterations: record.passwordIterations,
    });
    assert.equal(accepted, true);

    const rejected = await verifyPassword({
      username: "rider",
      password: "correct horsе",
      secret,
      expectedHash: record.passwordHash,
      salt: record.passwordSalt,
      iterations: record.passwordIterations,
    });
    assert.equal(rejected, false);
  });

  test("换一个服务端密钥即无法通过", async () => {
    const record = await hashPassword("correct horse", secret);
    const rejected = await verifyPassword({
      username: "rider",
      password: "correct horse",
      secret: "another-secret",
      expectedHash: record.passwordHash,
      salt: record.passwordSalt,
      iterations: record.passwordIterations,
    });
    assert.equal(rejected, false);
  });

  test("没有盐的旧账号回退到指纹比对", async () => {
    const legacyHash = await passwordFingerprint("Rider", "old password", secret);
    const accepted = await verifyPassword({
      username: "rider",
      password: "old password",
      secret,
      expectedHash: legacyHash,
      salt: null,
      iterations: null,
    });
    assert.equal(accepted, true);

    const rejected = await verifyPassword({
      username: "rider",
      password: "old password!",
      secret,
      expectedHash: legacyHash,
      salt: null,
      iterations: null,
    });
    assert.equal(rejected, false);
  });

  test("损坏的盐或越界迭代次数不会被接受", async () => {
    const record = await hashPassword("correct horse", secret);
    for (const salt of ["", "zz", "abc"]) {
      const rejected = await verifyPassword({
        username: "rider",
        password: "correct horse",
        secret,
        expectedHash: record.passwordHash,
        salt,
        iterations: record.passwordIterations,
      });
      assert.equal(rejected, false, salt);
    }
    const tooFew = await verifyPassword({
      username: "rider",
      password: "correct horse",
      secret,
      expectedHash: record.passwordHash,
      salt: record.passwordSalt,
      iterations: 1000,
    });
    assert.equal(tooFew, false);
  });

  test("指纹比对大小写不敏感且长度不同即失败", async () => {
    const left = await passwordFingerprint("Rider", "pw", secret);
    const right = await passwordFingerprint("rider", "pw", secret);
    assert.equal(left, right);
    assert.equal(fingerprintsMatch(left, right), true);
    assert.equal(fingerprintsMatch(left, `${left}0`), false);
    assert.equal(fingerprintsMatch(left, `${left.slice(0, -1)}0`), false);
  });
});
