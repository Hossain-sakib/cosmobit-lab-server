import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import fs from "node:fs/promises";
if (
  !process.env.FIREBASE_AUTH_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST.startsWith("127.0.0.1:")
)
  throw new Error(
    "Integration tests require the local Firebase Auth emulator.",
  );
process.env.FIREBASE_PROJECT_ID = "demo-cosmobit";
process.env.IMAGE_STORAGE = "local";
process.env.NODE_ENV = "test";
process.env.NOTIFICATION_EMAILS_ENABLED = "false";
process.env.CLIENT_URL = "http://localhost:5173";
const { createApp } = await import("../src/app.js");
const { firebaseAuth } = await import("../src/lib/firebase.js");
const { default: User } = await import("../src/models/User.js");
const { default: Post } = await import("../src/models/Post.js");
const { default: WorkItem } = await import("../src/models/WorkItem.js");
const { default: CommunityPost } =
  await import("../src/models/CommunityPost.js");
const {
  ManagedProject,
  SpecialOrder,
  Product,
  ProductLead,
  Department,
  Employee,
  TeamTask,
  SalesActivity,
  DistributionHistory,
  CareerApplication,
} = await import("../src/models/Management.js");
const uidList = [];
let uploaded;
test("Firebase, API, CMS, community, and CRM integration", async (t) => {
  const db = `cosmobit_test_${randomUUID().replaceAll("-", "")}`;
  const previousMongoURI = process.env.MONGODB_URI;
  process.env.MONGODB_URI = `mongodb://127.0.0.1:27017/${db}`;
  await mongoose.connect(process.env.MONGODB_URI);
  await Promise.all(
    [
      User,
      Post,
      WorkItem,
      CommunityPost,
      ManagedProject,
      SpecialOrder,
      Product,
      ProductLead,
      Department,
      Employee,
      TeamTask,
      SalesActivity,
      DistributionHistory,
      CareerApplication,
    ].map((Model) => Model.init()),
  );
  const server = createApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function req(path, { token, body, method = "GET", headers = {} } = {}) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, data: await res.json() };
  }
  async function signup() {
    const password = randomUUID();
    const res = await fetch(
      `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: `${randomUUID()}@example.com`,
          password,
          returnSecureToken: true,
        }),
      },
    );
    const data = await res.json();
    assert.equal(res.status, 200);
    uidList.push(data.localId);
    assert.equal((await req("/auth/me", { token: data.idToken })).status, 200);
    return { ...data, password };
  }
  try {
    const admin = await signup();
    const regular = await signup();
    const token = admin.idToken;
    await User.updateOne(
      { firebaseUid: admin.localId },
      { $set: { role: "admin" } },
    );
    await t.test(
      "readiness, authentication, profile validation, and authorization",
      async () => {
        assert.equal((await req("/health")).status, 200);
        assert.equal((await req("/auth/me")).status, 401);
        assert.equal((await req("/auth/me", { token: "invalid" })).status, 401);
        assert.equal(
          (await req("/crm/records", { token: regular.idToken })).status,
          403,
        );
        assert.equal(
          (
            await req("/auth/register", {
              method: "POST",
              token,
              body: { username: { $ne: null }, displayName: "Test" },
            })
          ).status,
          400,
        );
        const registered = await req("/auth/register", {
          method: "POST",
          token: regular.idToken,
          body: {
            username: "member",
            displayName: "Member Name",
            role: "admin",
          },
        });
        assert.equal(registered.status, 200);
        assert.equal(registered.data.user.role, "user");
        assert.equal(
          (
            await req("/auth/register", {
              method: "POST",
              token,
              body: { username: "member", displayName: "Duplicate" },
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await req("/contact", {
              method: "POST",
              body: {},
              headers: { Origin: "https://evil.example" },
            })
          ).status,
          403,
        );
        const malformed = await fetch(`${base}/contact`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{",
        });
        assert.equal(malformed.status, 400);
      },
    );
    await t.test(
      "homepage banner CMS enforces edit permission and never exposes drafts",
      async () => {
        const payload = {
          title: "A coordinated scene",
          caption: "A clear next step",
          imageUrl: "https://res.cloudinary.com/demo/image/upload/banner.webp",
          alt: "A friendly alien beside a project toolkit",
          status: "draft",
          sortOrder: 1,
        };
        assert.equal(
          (
            await req("/management/homepage-banners", {
              method: "POST",
              token: regular.idToken,
              body: payload,
            })
          ).status,
          403,
        );
        const created = await req("/management/homepage-banners", {
          method: "POST",
          token,
          body: payload,
        });
        assert.equal(created.status, 201);
        assert.equal((await req("/content/banners")).data.records.length, 0);
        assert.equal(
          (
            await req(
              `/management/homepage-banners/${created.data.record._id}`,
              {
                method: "PATCH",
                token,
                body: {
                  ...payload,
                  version: created.data.record.version,
                  status: "published",
                },
              },
            )
          ).status,
          200,
        );
        const published = await req("/content/banners");
        assert.equal(published.data.records.length, 1);
        assert.equal(published.data.records[0].alt, payload.alt);
        assert.equal(published.data.records[0].createdBy, undefined);
        assert.equal(
          (
            await req("/management/homepage-banners", {
              method: "POST",
              token,
              body: { ...payload, imageUrl: "javascript:alert(1)" },
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      "notifications are personal and stop exposing records after access is removed",
      async () => {
        const watcher = await signup();
        await User.updateOne(
          { firebaseUid: watcher.localId },
          { $set: { role: "web_developer" } },
        );
        const account = await User.findOne({ firebaseUid: watcher.localId });
        const adminAccount = await User.findOne({ firebaseUid: admin.localId });
        const project = await ManagedProject.create({
          projectName: "Scoped notification test",
          memberUserIds: [account._id],
          createdBy: adminAccount._id,
          updatedBy: adminAccount._id,
        });
        const Notification = mongoose.model("StudioNotification");
        const own = await Notification.create({
          userId: account._id,
          eventKey: "scope-check",
          title: "Private project update",
          message: "Assigned project details",
          link: `/studio/projects/${project._id}`,
        });
        const other = await Notification.create({
          userId: adminAccount._id,
          eventKey: "other-owner",
          title: "Another account",
          message: "Private",
          link: `/studio/projects/${project._id}`,
        });
        const feed = await req("/management/notifications", {
          token: watcher.idToken,
        });
        assert.equal(feed.status, 200);
        assert.equal(feed.data.unread, 1);
        assert.equal(feed.data.records[0]._id, String(own._id));
        assert.equal(
          (
            await req(`/management/notifications/${other._id}/read`, {
              method: "PATCH",
              token: watcher.idToken,
              body: {},
            })
          ).status,
          404,
        );
        const read = await req(`/management/notifications/${own._id}/read`, {
          method: "PATCH",
          token: watcher.idToken,
          body: {},
        });
        assert.equal(read.status, 200);
        assert.ok(read.data.record.readAt);
        assert.equal(read.data.record.title, undefined);
        await ManagedProject.updateOne(
          { _id: project._id },
          { $set: { memberUserIds: [] } },
        );
        const revoked = await req("/management/notifications", {
          token: watcher.idToken,
        });
        assert.equal(revoked.status, 200);
        assert.equal(revoked.data.records.length, 0);
        assert.equal(revoked.data.unread, 0);
      },
    );
    await t.test(
      "Netlify adapter routes direct and rewritten API requests",
      async () => {
        const { handler } = await import("../netlify/functions/api.mjs");
        for (const path of [
          "/api/health",
          "/.netlify/functions/api/api/health",
        ]) {
          const response = await handler(
            { path, httpMethod: "GET", headers: {}, body: null },
            {},
          );
          assert.equal(response.statusCode, 200);
          assert.equal(JSON.parse(response.body).status, "ok");
        }
        const response = await handler(
          {
            path: "/api/management/summary",
            httpMethod: "GET",
            headers: {},
            body: null,
          },
          {},
        );
        assert.equal(response.statusCode, 401);
      },
    );
    await t.test(
      "shared function rate counters reconcile concurrent instances and reset expired windows",
      async () => {
        const { MongoRateLimitStore } = await import("../src/lib/rateLimit.js");
        const one = new MongoRateLimitStore("test"),
          two = new MongoRateLimitStore("test");
        one.init({ windowMs: 60000 });
        two.init({ windowMs: 60000 });
        await Promise.all(
          Array.from({ length: 20 }, (_, index) =>
            (index % 2 ? one : two).increment("client"),
          ),
        );
        assert.equal((await one.increment("client")).totalHits, 21);
        assert.equal(
          (
            await new MongoRateLimitStore("another")
              .collection()
              .findOne({ _id: one.key("client") })
          ).totalHits,
          21,
        );
        await one
          .collection()
          .updateOne(
            { _id: one.key("client") },
            { $set: { resetTime: new Date(0) } },
          );
        assert.equal((await two.increment("client")).totalHits, 1);
        await one.resetKey("client");
      },
    );
    let draft;
    await t.test(
      "draft privacy, slug collisions, safe update fields and async errors",
      async () => {
        const created = await req("/posts", {
          method: "POST",
          token,
          body: {
            title: "Hidden draft",
            excerpt: "Preview",
            content: "Private text",
            published: false,
          },
        });
        assert.equal(created.status, 201);
        draft = created.data.post;
        assert.equal((await req(`/posts/${draft.slug}`)).status, 404);
        assert.equal((await req("/posts")).data.posts.length, 0);
        assert.equal(
          (await req("/admin/posts", { token })).data.posts.length,
          1,
        );
        assert.equal(
          (await req("/admin/messages/invalid", { token, method: "DELETE" }))
            .status,
          400,
        );
        assert.equal(
          (
            await req(`/posts/${draft._id}`, {
              method: "PUT",
              token,
              body: { published: "false" },
            })
          ).status,
          400,
        );
        const updated = await req(`/posts/${draft._id}`, {
          method: "PUT",
          token,
          body: { published: true, _id: "wrong" },
        });
        assert.equal(updated.status, 200);
        assert.equal(updated.data.post._id, draft._id);
        const second = await req("/posts", {
          method: "POST",
          token,
          body: {
            title: draft.title,
            excerpt: "Preview",
            content: "Public text",
          },
        });
        assert.notEqual(second.data.post.slug, draft.slug);
        assert.equal((await req(`/posts/${draft.slug}`)).status, 200);
        assert.equal(
          (
            await req("/jobs", {
              method: "POST",
              token,
              body: {
                title: "Engineer",
                department: "Engineering",
                description: "Build things",
                type: "bad",
              },
            })
          ).status,
          400,
        );
      },
    );
    await t.test(
      "CRM records, relationships, validation, history, search, archive and restore",
      async () => {
        const create = async (body) =>
          req("/crm/records", { token, method: "POST", body });
        const client = await create({
          kind: "client",
          title: "Acme [HQ]",
          email: "client@example.com",
        });
        assert.equal(client.status, 201);
        const project = await create({
          kind: "project",
          title: "Website",
          clientId: client.data.record._id,
          value: 5000,
          dueDate: "2020-01-01",
        });
        assert.equal(project.status, 201);
        const task = await create({
          kind: "task",
          title: "Deliver website",
          projectId: project.data.record._id,
          status: "blocked",
        });
        assert.equal(task.status, 201);
        assert.equal(
          (await create({ kind: "task", title: "Invalid", status: "won" }))
            .status,
          400,
        );
        assert.equal(
          (
            await create({
              kind: "note",
              title: "Invalid",
              clientId: project.data.record._id,
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await create({
              kind: "task",
              title: "Invalid",
              dueDate: "2026-02-30",
            })
          ).status,
          400,
        );
        assert.equal(
          (await req("/crm/records?kind=client&search=%5BHQ%5D", { token }))
            .data.total,
          1,
        );
        const patched = await req(`/crm/records/${task.data.record._id}`, {
          token,
          method: "PATCH",
          body: { status: "done", createdBy: "bad" },
        });
        assert.equal(patched.status, 200);
        assert.equal(patched.data.record.history.length, 2);
        assert.equal(
          (
            await req(`/crm/records/${task.data.record._id}`, {
              token,
              method: "PATCH",
              body: { value: 42 },
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await req(`/crm/records/${project.data.record._id}`, {
              token,
              method: "PATCH",
              body: { projectId: project.data.record._id },
            })
          ).status,
          400,
        );
        assert.equal((await req("/crm/summary", { token })).data.overdue, 1);
        assert.equal(
          (
            await req(`/crm/records/${client.data.record._id}`, {
              token,
              method: "PATCH",
              body: { archived: true },
            })
          ).status,
          200,
        );
        assert.equal(
          (await req("/crm/records?kind=client", { token })).data.total,
          0,
        );
        assert.equal(
          (await req("/crm/records?kind=client&archived=true", { token })).data
            .total,
          1,
        );
        assert.equal(
          (
            await req(`/crm/records/${client.data.record._id}`, {
              token,
              method: "PATCH",
              body: { archived: false },
            })
          ).status,
          200,
        );
      },
    );
    await t.test(
      "community uploads, display names, concurrent likes, comments and ownership",
      async () => {
        const fake = new FormData();
        fake.append(
          "image",
          new Blob(["not an image"], { type: "image/png" }),
          "fake.png",
        );
        let result = await fetch(`${base}/community/posts`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${regular.idToken}`,
            "X-Requested-With": "CosmoBit",
          },
          body: fake,
        });
        assert.equal(result.status, 400);
        const image = await sharp({
          create: { width: 5, height: 5, channels: 3, background: "#ffffff" },
        })
          .png()
          .toBuffer();
        const form = new FormData();
        form.append(
          "image",
          new Blob([image], { type: "image/png" }),
          "image.png",
        );
        result = await fetch(`${base}/community/posts`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${regular.idToken}`,
            "X-Requested-With": "CosmoBit",
          },
          body: form,
        });
        assert.equal(result.status, 201);
        const { post } = await result.json();
        uploaded = post.imageUrl;
        assert.equal(post.authorDisplayName, "Member Name");
        assert.match(post.imageUrl, /\.webp$/);
        const imageResponse = await fetch(
          `${base.replace("/api", "")}${post.imageUrl}`,
        );
        assert.equal(imageResponse.status, 200);
        assert.match(imageResponse.headers.get("content-type"), /image\/webp/);
        await Promise.all(
          Array.from({ length: 4 }, () =>
            req(`/community/posts/${post._id}/like`, {
              method: "POST",
              token,
              body: {},
            }),
          ),
        );
        const stored = await CommunityPost.findById(post._id);
        assert.equal(stored.likes.length, 0);
        const comment = await req(`/community/posts/${post._id}/comments`, {
          method: "POST",
          token: regular.idToken,
          body: { text: "A comment" },
        });
        assert.equal(comment.status, 201);
        assert.equal(
          (
            await req(
              `/community/posts/${post._id}/comments/${comment.data.comments[0]._id}`,
              { method: "DELETE", token, body: {} },
            )
          ).status,
          200,
        );
        const outsider = await signup();
        assert.equal(
          (
            await req(`/community/posts/${post._id}`, {
              token: outsider.idToken,
              method: "DELETE",
              body: {},
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await req(`/community/posts/${post._id}`, {
              token: regular.idToken,
              method: "DELETE",
              body: {},
            })
          ).status,
          200,
        );
        uploaded = null;
      },
    );
    await t.test(
      "contact, newsletter deduplication and rate limits",
      async () => {
        assert.equal(
          (
            await req("/contact", {
              method: "POST",
              body: { name: "Test", email: { $ne: null }, message: "Hello" },
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await req("/contact", {
              method: "POST",
              body: {
                name: "Test",
                email: "test@example.com",
                message: "Hello",
              },
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await req("/newsletter", {
              method: "POST",
              body: { email: "test@example.com" },
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await req("/newsletter", {
              method: "POST",
              body: { email: "TEST@example.com" },
            })
          ).status,
          200,
        );
        for (let i = 0; i < 4; i++)
          await req("/contact", {
            method: "POST",
            body: { name: "Test", email: "test@example.com", message: "Hello" },
          });
        assert.equal(
          (
            await req("/contact", {
              method: "POST",
              body: {
                name: "Test",
                email: "test@example.com",
                message: "Hello",
              },
            })
          ).status,
          429,
        );
      },
    );
    await t.test(
      "separate projects and special orders, formulas, optimistic updates and import deduplication",
      async () => {
        const created = await req("/management/projects", {
          token,
          method: "POST",
          body: {
            projectName: "Real delivery",
            account: "Profile",
            clientName: "Client",
            orderAmount: 100,
            bonusAmount: 20,
            feePercent: 20,
            orderDate: "2025-11-10",
            deliveryLastDate: "2025-11-20",
            orderedBy: "Seller",
            developer: "Operations",
            pages: [
              { name: "Home", status: "Done" },
              { name: "About", status: "Pending" },
            ],
            salesAllocations: [
              { person: "Seller", percent: 60 },
              { person: "Partner", percent: 40 },
            ],
          },
        });
        assert.equal(created.status, 201);
        const project = created.data.record;
        assert.equal(project.totalAfterFiverr, 96);
        assert.equal(project.pageProgress, 50);
        assert.equal(project.version, 0);
        const special = await req("/management/special-orders", {
          token,
          method: "POST",
          body: {
            profileName: "Special",
            orderAmount: 500,
            orderStartDate: "2025-11-01",
            timelineDays: 10,
            review: "Yes",
            secretReview: "No",
          },
        });
        assert.equal(special.status, 201);
        assert.equal(special.data.record.effectiveDeliveryDate, "2025-11-11");
        assert.equal(
          (
            await req(`/management/projects/${special.data.record._id}`, {
              token,
            })
          ).status,
          404,
        );
        assert.equal(
          (await req(`/management/special-orders/${project._id}`, { token }))
            .status,
          404,
        );
        const edit = await req(`/management/projects/${project._id}`, {
          token,
          method: "PATCH",
          body: { version: 0, status: "in-progress" },
        });
        assert.equal(edit.status, 200);
        assert.equal(edit.data.record.version, 1);
        assert.equal(
          (
            await req(`/management/projects/${project._id}`, {
              token,
              method: "PATCH",
              body: { version: 0, status: "completed" },
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await req("/management/projects", {
              token,
              method: "POST",
              body: {
                projectName: "Bad allocation",
                salesAllocations: [
                  { person: "A", percent: 70 },
                  { person: "B", percent: 40 },
                ],
              },
            })
          ).status,
          400,
        );
        const payload = {
          records: [
            {
              name: "Sample",
              url: "https://example.com",
              medium: "website",
              collectionType: "work-sample",
              useStatus: "unused",
            },
          ],
        };
        assert.equal(
          (
            await req("/management/samples/bulk-import", {
              token,
              method: "POST",
              body: payload,
            })
          ).data.imported,
          1,
        );
        assert.equal(
          (
            await req("/management/samples/bulk-import", {
              token,
              method: "POST",
              body: payload,
            })
          ).data.duplicates,
          1,
        );
        const sample = (await req("/management/samples", { token })).data
          .records[0];
        assert.equal(
          (
            await req(`/management/samples/${sample._id}`, {
              token,
              method: "PATCH",
              body: {
                version: sample.version,
                useStatus: "used",
                usedBy: "Client",
              },
            })
          ).status,
          200,
        );
        assert.equal(
          (await req("/management/samples?status=used", { token })).data.total,
          1,
        );
      },
    );
    await t.test(
      "role permissions, project assignment and financial redaction",
      async () => {
        const developer = await signup();
        await User.updateOne(
          { firebaseUid: developer.localId },
          { $set: { role: "developer" } },
        );
        const profile = await User.findOne({ firebaseUid: developer.localId });
        const project = await req("/management/projects", {
          token,
          method: "POST",
          body: {
            projectName: "Assigned delivery",
            memberUserIds: [String(profile._id)],
            orderAmount: 1000,
          },
        });
        const own = await req(
          `/management/projects/${project.data.record._id}`,
          { token: developer.idToken },
        );
        assert.equal(own.status, 200);
        assert.equal(own.data.record.orderAmount, undefined);
        assert.equal(own.data.record.totalAfterFiverr, undefined);
        assert.equal(
          (await req("/management/projects", { token: developer.idToken })).data
            .total,
          1,
        );
        const work = await req("/management/my-work", {
          token: developer.idToken,
        });
        assert.equal(work.data.projects.length, 1);
        assert.equal(work.data.projects[0]._id, project.data.record._id);
        assert.equal(work.data.projects[0].totalAfterFiverr, undefined);
        assert.equal(
          (
            await req("/management/special-orders", {
              token: developer.idToken,
            })
          ).status,
          403,
        );
        assert.equal(
          (await req("/management/access", { token: developer.idToken }))
            .status,
          403,
        );
        assert.equal(
          (await req("/management/applications", { token: developer.idToken }))
            .status,
          403,
        );
        assert.equal(
          (
            await req(`/management/projects/${project.data.record._id}`, {
              token: developer.idToken,
              method: "PATCH",
              body: { version: 0, projectName: "No" },
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await req(`/management/access/${profile._id}`, {
              token,
              method: "PATCH",
              body: { role: "super_admin" },
            })
          ).status,
          403,
        );
        const deny = await req(`/management/access/${profile._id}`, {
          token,
          method: "PATCH",
          body: { deniedPermissions: ["projects:view"] },
        });
        assert.equal(deny.status, 200);
        assert.equal(
          (await req("/management/projects", { token: developer.idToken }))
            .status,
          403,
        );
      },
    );
    await t.test(
      "employee/department task scopes and limited self-service updates",
      async () => {
        const worker = await signup();
        const other = await signup();
        const workerUser = await User.findOne({ firebaseUid: worker.localId });
        const otherUser = await User.findOne({ firebaseUid: other.localId });
        const department = (
          await req("/management/departments", {
            token,
            method: "POST",
            body: { name: "Engineering" },
          })
        ).data.record;
        const employee = (
          await req("/management/employees", {
            token,
            method: "POST",
            body: {
              name: "Worker",
              departmentId: department._id,
              accountUserId: String(workerUser._id),
            },
          })
        ).data.record;
        const outsider = (
          await req("/management/employees", {
            token,
            method: "POST",
            body: {
              name: "Other worker",
              departmentId: department._id,
              accountUserId: String(otherUser._id),
            },
          })
        ).data.record;
        const assigned = await req("/management/team-tasks", {
          token,
          method: "POST",
          body: { title: "Personal work", employeeId: employee._id },
        });
        assert.equal(assigned.status, 201);
        await req("/management/team-tasks", {
          token,
          method: "POST",
          body: { title: "Department work", departmentId: department._id },
        });
        const privateTask = await req("/management/team-tasks", {
          token,
          method: "POST",
          body: { title: "Other personal work", employeeId: outsider._id },
        });
        assert.equal(
          (await req("/management/team-tasks", { token: worker.idToken })).data
            .total,
          2,
        );
        assert.equal(
          (await req("/management/my-work", { token: worker.idToken })).data
            .taskStats.open,
          2,
        );
        assert.equal(
          (
            await req(`/management/team-tasks/${privateTask.data.record._id}`, {
              token: worker.idToken,
            })
          ).status,
          404,
        );
        assert.equal(
          (
            await req(`/management/team-tasks/${assigned.data.record._id}`, {
              token: worker.idToken,
              method: "PATCH",
              body: { version: 0, status: "done", employeeComment: "Finished" },
            })
          ).status,
          200,
        );
        assert.equal(
          (
            await req(`/management/team-tasks/${assigned.data.record._id}`, {
              token: worker.idToken,
              method: "PATCH",
              body: { version: 1, endDate: "2026-12-31" },
            })
          ).status,
          403,
        );
      },
    );
    await t.test(
      "product lead isolation, employee ownership and per-product duplicates",
      async () => {
        const salesperson = await signup();
        const seller = await User.findOne({ firebaseUid: salesperson.localId });
        await req("/management/employees", {
          token,
          method: "POST",
          body: { name: "Sales", accountUserId: String(seller._id) },
        });
        await User.updateOne(
          { _id: seller._id },
          { $set: { role: "sales_executive" } },
        );
        const first = (
          await req("/management/products", {
            token,
            method: "POST",
            body: { name: "Product one" },
          })
        ).data.record;
        const second = (
          await req("/management/products", {
            token,
            method: "POST",
            body: { name: "Product two" },
          })
        ).data.record;
        const body = {
          clientName: "Prospect",
          email: "prospect@example.com",
          ownerUserId: String(seller._id),
        };
        const lead = await req(`/management/products/${first._id}/leads`, {
          token,
          method: "POST",
          body,
        });
        assert.equal(lead.status, 201);
        assert.equal(
          (
            await req(`/management/products/${first._id}/leads`, {
              token,
              method: "POST",
              body,
            })
          ).status,
          409,
        );
        assert.equal(
          (
            await req(`/management/products/${second._id}/leads`, {
              token,
              method: "POST",
              body,
            })
          ).status,
          201,
        );
        assert.equal(
          (
            await req(
              `/management/products/${second._id}/leads/${lead.data.record._id}`,
              { token },
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await req(`/management/products/${first._id}/leads`, {
              token: salesperson.idToken,
            })
          ).data.total,
          1,
        );
        await req(`/management/products/${first._id}/leads`, {
          token,
          method: "POST",
          body: {
            clientName: "Unassigned private lead",
            email: "private@example.com",
          },
        });
        assert.equal(
          (
            await req(`/management/products/${first._id}/leads`, {
              token: salesperson.idToken,
            })
          ).data.total,
          1,
        );
      },
    );
    await t.test(
      "marketplace shift reports and revenue attribution reconcile without special-order revenue",
      async () => {
        const daily = await req("/management/sales-activity", {
          token,
          method: "POST",
          body: {
            date: "2025-11-10",
            platform: "Fiverr",
            profile: "Account",
            morningQuery: 10,
            morningQuote: 5,
            eveningQuery: 3,
            nightOrder: 2,
          },
        });
        assert.equal(daily.status, 201);
        const report = await req(
          "/management/reports/marketplace?month=2025-11&platform=Fiverr",
          { token },
        );
        assert.equal(report.status, 200);
        assert.equal(report.data.totals.query, 13);
        assert.equal(report.data.totals.order, 2);
        const distribution = await req(
          "/management/reports/distribution?month=2025-11&platform=Fiverr",
          { token },
        );
        assert.equal(distribution.status, 200);
        assert.equal(distribution.data.totalNet, 96);
        assert.equal(
          distribution.data.sales.reduce(
            (n, r) => Math.round(n * 100) + Math.round(r.amount * 100),
            0,
          ) > 0,
          true,
        );
        assert.equal(
          distribution.data.sales.find((r) => r.person === "Seller").amount,
          57.6,
        );
        assert.equal(
          distribution.data.operations.find((r) => r.person === "Operations")
            .amount,
          96,
        );
        await req("/management/distribution-history", {
          token,
          method: "POST",
          body: {
            month: "2025-11",
            person: "Historical seller",
            division: "sales",
            platform: "Fiverr",
            amount: 500,
            orders: 4,
          },
        });
        const history = await req(
          "/management/reports/distribution?month=2025-11&source=history",
          { token },
        );
        assert.equal(history.data.sales[0].amount, 500);
        assert.equal(history.data.totalNet, 0);
      },
    );
    await t.test(
      "career submission idempotency, private CVs, recruitment authorization and upload validation",
      async () => {
        async function submit(key, fake = false) {
          const form = new FormData();
          for (const [k, v] of Object.entries({
            fullName: "Applicant",
            email: "applicant@example.com",
            phone: "12345",
            position: "Developer",
            consent: "true",
          }))
            form.append(k, v);
          form.append(
            "resume",
            new Blob(
              [fake ? "not PDF" : "%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"],
              { type: "application/pdf" },
            ),
            "cv.pdf",
          );
          const response = await fetch(`${base}/applications`, {
            method: "POST",
            headers: { "X-Requested-With": "CosmoBit", "Idempotency-Key": key },
            body: form,
          });
          return response;
        }
        assert.equal((await submit(randomUUID(), true)).status, 400);
        const key = randomUUID();
        assert.equal((await submit(key)).status, 201);
        assert.equal((await submit(key)).status, 200);
        const applications = await req("/management/applications", { token });
        assert.equal(applications.status, 200);
        assert.equal(applications.data.total, 1);
        const application = applications.data.records[0];
        assert.equal(application.resumeFilename, undefined);
        assert.equal(application.resumeAvailable, true);
        const stored = await CareerApplication.findById(application._id).select(
          "+resumeFileId",
        );
        assert.ok(stored.resumeFileId);
        assert.equal(application.resumeFileId, undefined);
        const bucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
          bucketName: "privateResumes",
        });
        assert.equal(
          await mongoose.connection.db
            .collection("privateResumes.files")
            .countDocuments({}),
          1,
        );
        assert.equal(
          (
            await fetch(
              `${base.replace("/api", "")}/uploads/.private-applications/${stored.resumeFileId}`,
            )
          ).status,
          404,
        );
        assert.equal(
          (await fetch(`${base}/applications/${application._id}/resume`))
            .status,
          401,
        );
        const downloaded = await fetch(
          `${base}/applications/${application._id}/resume`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        assert.equal(downloaded.status, 200);
        assert.equal(downloaded.headers.get("cache-control"), "no-store");
        assert.ok((await downloaded.text()).startsWith("%PDF-"));
        assert.equal(
          (
            await fetch(`${base}/applications/${application._id}/resume`, {
              headers: { Authorization: `Bearer ${regular.idToken}` },
            })
          ).status,
          403,
        );
      },
    );
    await t.test(
      "own profile editing persists fields and cannot alter identity or access",
      async () => {
        const response = await req("/auth/profile", {
          method: "PATCH",
          token: regular.idToken,
          body: {
            displayName: "Profile Test",
            phone: "01234",
            jobTitle: "Designer",
            bio: "A short profile.",
          },
        });
        assert.equal(response.status, 200);
        assert.equal(response.data.user.phone, "01234");
        assert.equal(
          (
            await req("/auth/profile", {
              method: "PATCH",
              token: regular.idToken,
              body: { role: "super_admin" },
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await req("/auth/profile", {
              method: "PATCH",
              token: regular.idToken,
              body: { email: "other@example.com" },
            })
          ).status,
          400,
        );
        const profile = await req("/auth/me", { token: regular.idToken });
        assert.equal(profile.data.user.role, "user");
        assert.equal(profile.data.user.bio, "A short profile.");
        assert.equal(profile.data.user.avatarPublicId, undefined);
      },
    );
    await t.test(
      "chat restricts contacts and messages to verified authorized participants and deduplicates sends",
      async () => {
        const { ChatThread, ChatMessage } =
          await import("../src/models/Chat.js");
        await Promise.all([ChatThread.init(), ChatMessage.init()]);
        async function verifiedAccount(role = "user") {
          const account = await signup();
          await firebaseAuth().updateUser(account.localId, {
            emailVerified: true,
          });
          await User.updateOne(
            { firebaseUid: account.localId },
            { $set: { role } },
          );
          const login = await fetch(
            `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                email: account.email,
                password: account.password,
                returnSecureToken: true,
              }),
            },
          );
          const data = await login.json();
          assert.equal(login.status, 200);
          await req("/auth/me", { token: data.idToken });
          return {
            token: data.idToken,
            user: await User.findOne({ firebaseUid: account.localId }),
          };
        }
        assert.equal(
          (await req("/chat/people", { token: regular.idToken })).status,
          403,
        );
        const sales = await verifiedAccount("sales_executive"),
          client = await verifiedAccount(),
          outsider = await verifiedAccount(),
          developer = await verifiedAccount("web_developer");
        const people = await req("/chat/people", { token: client.token });
        assert.equal(people.status, 200);
        assert.ok(people.data.people.some((p) => p._id === sales.user.id));
        assert.ok(!people.data.people.some((p) => p._id === developer.user.id));
        assert.ok(people.data.people.every((p) => p.email === undefined));
        for (const target of [developer, outsider])
          assert.equal(
            (
              await req("/chat/threads", {
                token: client.token,
                method: "POST",
                body: { userId: target.user.id },
              })
            ).status,
            403,
          );
        const created = await req("/chat/threads", {
          token: client.token,
          method: "POST",
          body: { userId: sales.user.id },
        });
        assert.equal(created.status, 200);
        const id = created.data.id;
        assert.equal(
          (
            await req("/chat/threads", {
              token: client.token,
              method: "POST",
              body: { userId: sales.user.id },
            })
          ).data.id,
          id,
        );
        assert.equal(
          (await req(`/chat/threads/${id}/messages`, { token: outsider.token }))
            .status,
          404,
        );
        const clientMessageId = randomUUID();
        const first = await req(`/chat/threads/${id}/messages`, {
          token: client.token,
          method: "POST",
          body: { text: "Hello, I need a website.", clientMessageId },
        });
        assert.equal(first.status, 200);
        const retry = await req(`/chat/threads/${id}/messages`, {
          token: client.token,
          method: "POST",
          body: { text: "Hello, I need a website.", clientMessageId },
        });
        assert.equal(retry.data.message._id, first.data.message._id);
        assert.equal(await ChatMessage.countDocuments({ threadId: id }), 1);
        const notifications = await mongoose.model("StudioNotification").find({
          userId: sales.user._id,
          eventKey: `chat-message:${first.data.message._id}`,
        });
        assert.equal(notifications.length, 1);
        assert.ok(!notifications[0].message.includes("Hello"));
        await req(`/chat/threads/${id}/messages`, {
          token: sales.token,
          method: "POST",
          body: {
            text: "Let’s discuss your project.",
            clientMessageId: randomUUID(),
          },
        });
        const history = await req(`/chat/threads/${id}/messages`, {
          token: client.token,
        });
        assert.equal(history.data.messages.length, 2);
        const read = await fetch(`${base}/chat/threads/${id}/read`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${client.token}`,
            "Content-Type": "application/json",
          },
          body: "{}",
        });
        assert.equal(read.status, 204);
        assert.equal(
          (await ChatThread.findById(id)).readAt.has(client.user.id),
          true,
        );
        assert.equal(
          (
            await req(`/chat/threads/${id}/read`, {
              token: client.token,
              method: "POST",
              headers: { Origin: "https://evil.example" },
              body: {},
            })
          ).status,
          403,
        );
        assert.equal(
          (await req("/chat/threads", { token: outsider.token })).data.threads
            .length,
          0,
        );
        const internal = await req("/chat/threads", {
          token: developer.token,
          method: "POST",
          body: { userId: sales.user.id },
        });
        assert.equal(internal.status, 200);
        assert.equal(
          (
            await req(`/chat/threads/${internal.data.id}/messages`, {
              token: client.token,
            })
          ).status,
          404,
        );
        await User.updateOne(
          { _id: sales.user._id },
          { $set: { studioSuspended: true } },
        );
        assert.equal(
          (await req(`/chat/threads/${id}/messages`, { token: client.token }))
            .status,
          403,
        );
        assert.equal(
          (await req("/chat/threads", { token: sales.token })).status,
          403,
        );
      },
    );
    await t.test(
      "founder bootstrap verifies exact identity and never reapplies a later role change",
      async () => {
        const { bootstrapFounder } =
          await import("../src/services/bootstrapFounder.js");
        const identity = await firebaseAuth().getUser(regular.localId);
        const oldUid = process.env.STUDIO_FOUNDER_UID,
          oldEmail = process.env.STUDIO_FOUNDER_EMAIL;
        try {
          process.env.STUDIO_FOUNDER_UID = regular.localId;
          process.env.STUDIO_FOUNDER_EMAIL = "mismatch@example.com";
          await assert.rejects(bootstrapFounder());
          process.env.STUDIO_FOUNDER_EMAIL = identity.email;
          await bootstrapFounder();
          const founder = await User.findOne({
            firebaseUid: regular.localId,
          }).select("+founderBootstrapAt");
          assert.equal(founder.role, "super_admin");
          assert.ok(founder.founderBootstrapAt);
          assert.equal(
            (await User.findOne({ firebaseUid: admin.localId })).role,
            "admin",
          );
          await User.updateOne(
            { _id: founder._id },
            { $set: { role: "user" } },
          );
          await bootstrapFounder();
          assert.equal((await User.findById(founder._id)).role, "user");
        } finally {
          if (oldUid === undefined) delete process.env.STUDIO_FOUNDER_UID;
          else process.env.STUDIO_FOUNDER_UID = oldUid;
          if (oldEmail === undefined) delete process.env.STUDIO_FOUNDER_EMAIL;
          else process.env.STUDIO_FOUNDER_EMAIL = oldEmail;
        }
      },
    );
    await t.test(
      "serverless database reconnects across repeated warm connection closures",
      async () => {
        const { serverlessDB } = await import("../src/lib/serverlessDb.js");
        for (let attempt = 0; attempt < 2; attempt++) {
          await mongoose.disconnect();
          await serverlessDB();
          assert.equal(mongoose.connection.readyState, 1);
          assert.ok(await User.exists({ firebaseUid: admin.localId }));
        }
      },
    );
    await t.test(
      "role changes and Firebase-disabled users take effect immediately",
      async () => {
        await User.updateOne(
          { firebaseUid: admin.localId },
          { $set: { role: "user" } },
        );
        assert.equal((await req("/crm/records", { token })).status, 403);
        await firebaseAuth().updateUser(regular.localId, { disabled: true });
        assert.equal(
          (await req("/auth/me", { token: regular.idToken })).status,
          401,
        );
      },
    );
  } finally {
    if (uploaded)
      await fs
        .unlink(new URL(`..${uploaded}`, import.meta.url))
        .catch(() => {});
    await Promise.all(uidList.map((uid) => firebaseAuth().deleteUser(uid)));
    await new Promise((resolve) => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
    if (previousMongoURI === undefined) delete process.env.MONGODB_URI;
    else process.env.MONGODB_URI = previousMongoURI;
  }
});
