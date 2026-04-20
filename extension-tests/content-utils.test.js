// Node.js tests for the pure utility functions used in content.js
// Run with: node extension/__tests__/content-utils.test.js

const assert = require("assert");

// ── Pure functions (duplicated here for testing — content.js can't be imported) ──

function extractPostUrn(postUrl) {
  const match = postUrl.match(/urn:li:activity:\d+/);
  return match ? match[0] : null;
}

function getCsrfToken(cookieString) {
  const match = cookieString.match(/JSESSIONID="?([^";]+)"?/);
  return match ? match[1] : null;
}

function parseCommenters(data) {
  const included = data.included || [];
  const profilesByUrn = {};
  for (const item of included) {
    if (item.$type && item.$type.includes("MiniProfile")) {
      profilesByUrn[item.entityUrn] = {
        profileId: item.objectUrn,
        profileName: [item.firstName, item.lastName].filter(Boolean).join(" "),
        profileUrl: item.publicIdentifier
          ? `https://www.linkedin.com/in/${item.publicIdentifier}/`
          : "",
      };
    }
  }
  const seen = new Set();
  const commenters = [];
  for (const item of included) {
    if (!item.$type?.includes("Comment")) continue;
    const memberActor =
      item.commenter?.["com.linkedin.voyager.feed.MemberActor"];
    if (!memberActor) continue;
    const profileUrn = memberActor.miniProfile;
    if (!profileUrn || seen.has(profileUrn)) continue;
    const profile = profilesByUrn[profileUrn];
    if (!profile) continue;
    seen.add(profileUrn);
    commenters.push({ ...profile, commentText: item.commentary?.text || "" });
  }
  return commenters;
}

// ── Tests ──

// extractPostUrn
assert.strictEqual(
  extractPostUrn("https://www.linkedin.com/feed/update/urn:li:activity:7123456789/"),
  "urn:li:activity:7123456789",
  "extractPostUrn: standard /feed/update/ URL"
);
assert.strictEqual(
  extractPostUrn("https://www.linkedin.com/posts/user_urn:li:activity:999-abc_a_activity_/"),
  "urn:li:activity:999",
  "extractPostUrn: /posts/ URL with digits only"
);
assert.strictEqual(
  extractPostUrn("https://www.linkedin.com/feed/"),
  null,
  "extractPostUrn: returns null when no URN present"
);

// getCsrfToken
assert.strictEqual(
  getCsrfToken('li_at=xxxx; JSESSIONID="ajax:1234567890"'),
  "ajax:1234567890",
  "getCsrfToken: quoted JSESSIONID"
);
assert.strictEqual(
  getCsrfToken("li_at=xxxx; JSESSIONID=ajax:1234567890"),
  "ajax:1234567890",
  "getCsrfToken: unquoted JSESSIONID"
);
assert.strictEqual(
  getCsrfToken("li_at=xxxx; lang=en"),
  null,
  "getCsrfToken: returns null when JSESSIONID absent"
);

// parseCommenters
const mockVoyagerResponse = {
  included: [
    {
      $type: "com.linkedin.voyager.identity.shared.MiniProfile",
      entityUrn: "urn:li:fs_miniProfile:ACoAAAxxxxx",
      objectUrn: "urn:li:member:789",
      firstName: "Alice",
      lastName: "Smith",
      publicIdentifier: "alice-smith",
    },
    {
      $type: "com.linkedin.voyager.feed.Comment",
      commentary: { text: "Great post!" },
      commenter: {
        "com.linkedin.voyager.feed.MemberActor": {
          miniProfile: "urn:li:fs_miniProfile:ACoAAAxxxxx",
        },
      },
    },
  ],
};

const commenters = parseCommenters(mockVoyagerResponse);
assert.strictEqual(commenters.length, 1, "parseCommenters: extracts one commenter");
assert.strictEqual(commenters[0].profileId, "urn:li:member:789", "parseCommenters: correct profileId");
assert.strictEqual(commenters[0].profileName, "Alice Smith", "parseCommenters: full name");
assert.strictEqual(
  commenters[0].profileUrl,
  "https://www.linkedin.com/in/alice-smith/",
  "parseCommenters: profile URL"
);
assert.strictEqual(commenters[0].commentText, "Great post!", "parseCommenters: comment text");

// Deduplication
const mockWithDupe = {
  included: [
    ...mockVoyagerResponse.included,
    {
      $type: "com.linkedin.voyager.feed.Comment",
      commentary: { text: "Also me" },
      commenter: {
        "com.linkedin.voyager.feed.MemberActor": {
          miniProfile: "urn:li:fs_miniProfile:ACoAAAxxxxx", // same person
        },
      },
    },
  ],
};
const deduped = parseCommenters(mockWithDupe);
assert.strictEqual(deduped.length, 1, "parseCommenters: deduplicates same commenter");

// Empty response
assert.deepStrictEqual(parseCommenters({}), [], "parseCommenters: handles empty included");

console.log("All tests passed! ✓");
