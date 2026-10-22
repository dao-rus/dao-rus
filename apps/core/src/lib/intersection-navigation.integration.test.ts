import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyMigration, migrationFile } from "./migration-integrity";
import { getVisibleProfileAboutWithDatabase } from "./profile-about";
import { listParticipantsDirectoryWithDatabase } from "./participants-directory";
import { createCommunityPostWithDatabase, listCommunityPostsWithDatabase, CommunityMembershipError } from "./communities";

const databaseUrl = process.env.GUARDIAN_FORUM_TEST_DATABASE_URL;
const schema = `intersection_test_${randomUUID().replaceAll("-", "")}`;
const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public`, max: 3 });
const modes = ["public", "members", "private", "circle", "match_only"] as const;
const ids = modes.map(() => randomUUID());
const viewer = randomUUID();
const outsider = randomUUID();
const residence = { name: "Казань", type: "город", country: "Россия" };
let created = false;

describe.skipIf(!databaseUrl)("intersection navigation privacy", () => {
  beforeAll(async () => {
    const url = new URL(databaseUrl!);
    if (url.hostname !== "127.0.0.1" || url.pathname !== "/guardian_forum_tests") {
      throw new Error("Use the isolated local guardian_forum_tests database");
    }
    await pool.query(`CREATE SCHEMA ${schema}`);
    created = true;
    await pool.query("CREATE TABLE schema_migrations(name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
    const directory = new URL("../../migrations/", import.meta.url);
    const client = await pool.connect();
    try {
      for (const name of readdirSync(directory).filter(name => name.endsWith(".sql")).sort()) {
        await applyMigration(client, migrationFile(name, readFileSync(new URL(name, directory), "utf8")));
      }
    } finally { client.release(); }
    for (const [index, id] of [...ids, viewer, outsider].entries()) {
      await pool.query("INSERT INTO participants(id, display_name) VALUES ($1, $2)", [id, `Test ${index}`]);
      await pool.query("INSERT INTO events(event_type, participant_id, payload) VALUES ('participant.logged_in', $1, '{}')", [id]);
      if (id !== outsider) {
        await pool.query("INSERT INTO participant_interests(participant_id, label, normalized_label, visibility) VALUES ($1, 'История', 'история', $2)",
          [id, modes[index] ?? "private"]);
        await pool.query("UPDATE participants SET residence_name=$2, residence_type=$3, residence_country=$4 WHERE id=$1",
          [id, residence.name, residence.type, residence.country]);
      } else {
        await pool.query("UPDATE participants SET residence_name=$2 WHERE id=$1", [id, residence.name]);
      }
    }
  }, 60000);

  afterAll(async () => {
    if (created) await pool.query(`DROP SCHEMA ${schema} CASCADE`);
    await pool.end();
  });

  it("does not reveal hidden interests through matching, counts, search or profile links", async () => {
    const entries = await listParticipantsDirectoryWithDatabase(pool, "", { interest: " ИСТОРИЯ ", viewerParticipantId: viewer });
    expect(entries.map(entry => entry.participantId).sort()).toEqual([ids[0], ids[1], viewer].sort());
    for (const [index, id] of ids.entries()) {
      const profile = await getVisibleProfileAboutWithDatabase(pool, id, viewer, false);
      expect(profile?.interests.map(interest => interest.label)).toEqual(index < 2 ? ["История"] : []);
      const searched = await listParticipantsDirectoryWithDatabase(pool, `Test ${index}`, { interest: "История", viewerParticipantId: viewer });
      expect(searched.map(entry => entry.participantId)).toEqual(index < 2 ? [id] : []);
    }
    const own = await getVisibleProfileAboutWithDatabase(pool, viewer, viewer, false);
    expect(own?.interests[0].visibility).toBe("private");
  });

  it("uses the exact geographical community and its existing announcement board", async () => {
    const entries = await listParticipantsDirectoryWithDatabase(pool, "", { residence, viewerParticipantId: viewer });
    expect(entries.map(entry => entry.participantId).sort()).toEqual([...ids, viewer].sort());
    const incomplete = await getVisibleProfileAboutWithDatabase(pool, outsider, viewer, false);
    expect(incomplete?.city).toBe(residence.name);
    expect(incomplete?.residence).toBeNull();
    const community = { type: "residence", residence } as const;
    await createCommunityPostWithDatabase(pool, community, viewer, "Синтетическое объявление");
    expect((await listCommunityPostsWithDatabase(pool, community)).map(post => post.body)).toEqual(["Синтетическое объявление"]);
    expect(await listCommunityPostsWithDatabase(pool, { type: "residence", residence: { ...residence, country: "Другая страна" } })).toEqual([]);
    await expect(createCommunityPostWithDatabase(pool, community, outsider, "Не участник сообщества"))
      .rejects.toThrow(CommunityMembershipError);
  });
});
