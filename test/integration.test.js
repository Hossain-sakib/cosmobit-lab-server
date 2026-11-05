import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import fs from 'node:fs/promises';
if (!process.env.FIREBASE_AUTH_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST.startsWith('127.0.0.1:')) throw new Error('Integration tests require the local Firebase Auth emulator.');
process.env.FIREBASE_PROJECT_ID = 'demo-cosmobit';
process.env.CLIENT_URL = 'http://localhost:5173';
const { createApp } = await import('../src/app.js');
const { firebaseAuth } = await import('../src/lib/firebase.js');
const { default: User } = await import('../src/models/User.js');
const { default: Post } = await import('../src/models/Post.js');
const { default: WorkItem } = await import('../src/models/WorkItem.js');
const { default: CommunityPost } = await import('../src/models/CommunityPost.js');
const uidList = [];
let uploaded;
test('Firebase, API, CMS, community, and CRM integration', async t => {
  const db = `cosmobit_test_${randomUUID().replaceAll('-', '')}`;
  await mongoose.connect(`mongodb://127.0.0.1:27017/${db}`);
  await Promise.all([User.init(), Post.init(), WorkItem.init(), CommunityPost.init()]);
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api`;
  async function req(path, { token, body, method = 'GET', headers = {} } = {}) {
    const res = await fetch(`${base}${path}`, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: res.status, data: await res.json() };
  }
  async function signup() {
    const res = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${randomUUID()}@example.com`, password: randomUUID(), returnSecureToken: true }) });
    const data = await res.json();
    assert.equal(res.status, 200);
    uidList.push(data.localId);
    assert.equal((await req('/auth/me', { token: data.idToken })).status, 200);
    return data;
  }
  try {
    const admin = await signup();
    const regular = await signup();
    const token = admin.idToken;
    await User.updateOne({ firebaseUid: admin.localId }, { $set: { role: 'admin' } });
    await t.test('readiness, authentication, profile validation, and authorization', async () => {
      assert.equal((await req('/health')).status, 200);
      assert.equal((await req('/auth/me')).status, 401);
      assert.equal((await req('/auth/me', { token: 'invalid' })).status, 401);
      assert.equal((await req('/crm/records', { token: regular.idToken })).status, 403);
      assert.equal((await req('/auth/register', { method: 'POST', token, body: { username: { $ne: null }, displayName: 'Test' } })).status, 400);
      const registered = await req('/auth/register', { method: 'POST', token: regular.idToken, body: { username: 'member', displayName: 'Member Name', role: 'admin' } });
      assert.equal(registered.status, 200); assert.equal(registered.data.user.role, 'user');
      assert.equal((await req('/auth/register', { method: 'POST', token, body: { username: 'member', displayName: 'Duplicate' } })).status, 409);
      assert.equal((await req('/contact', { method: 'POST', body: {}, headers: { Origin: 'https://evil.example' } })).status, 403);
      const malformed = await fetch(`${base}/contact`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
      assert.equal(malformed.status, 400);
    });
    let draft;
    await t.test('draft privacy, slug collisions, safe update fields and async errors', async () => {
      const created = await req('/posts', { method: 'POST', token, body: { title: 'Hidden draft', excerpt: 'Preview', content: 'Private text', published: false } });
      assert.equal(created.status, 201); draft = created.data.post;
      assert.equal((await req(`/posts/${draft.slug}`)).status, 404);
      assert.equal((await req('/posts')).data.posts.length, 0);
      assert.equal((await req('/admin/posts', { token })).data.posts.length, 1);
      assert.equal((await req('/admin/messages/invalid', { token, method: 'DELETE' })).status, 400);
      assert.equal((await req(`/posts/${draft._id}`, { method: 'PUT', token, body: { published: 'false' } })).status, 400);
      const updated = await req(`/posts/${draft._id}`, { method: 'PUT', token, body: { published: true, _id: 'wrong' } });
      assert.equal(updated.status, 200); assert.equal(updated.data.post._id, draft._id);
      const second = await req('/posts', { method: 'POST', token, body: { title: draft.title, excerpt: 'Preview', content: 'Public text' } });
      assert.notEqual(second.data.post.slug, draft.slug);
      assert.equal((await req(`/posts/${draft.slug}`)).status, 200);
      assert.equal((await req('/jobs', { method: 'POST', token, body: { title: 'Engineer', department: 'Engineering', description: 'Build things', type: 'bad' } })).status, 400);
    });
    await t.test('CRM records, relationships, validation, history, search, archive and restore', async () => {
      const create = async body => req('/crm/records', { token, method: 'POST', body });
      const client = await create({ kind: 'client', title: 'Acme [HQ]', email: 'client@example.com' });
      assert.equal(client.status, 201);
      const project = await create({ kind: 'project', title: 'Website', clientId: client.data.record._id, value: 5000, dueDate: '2020-01-01' });
      assert.equal(project.status, 201);
      const task = await create({ kind: 'task', title: 'Deliver website', projectId: project.data.record._id, status: 'blocked' });
      assert.equal(task.status, 201);
      assert.equal((await create({ kind: 'task', title: 'Invalid', status: 'won' })).status, 400);
      assert.equal((await create({ kind: 'note', title: 'Invalid', clientId: project.data.record._id })).status, 400);
      assert.equal((await create({ kind: 'task', title: 'Invalid', dueDate: '2026-02-30' })).status, 400);
      assert.equal((await req('/crm/records?kind=client&search=%5BHQ%5D', { token })).data.total, 1);
      const patched = await req(`/crm/records/${task.data.record._id}`, { token, method: 'PATCH', body: { status: 'done', createdBy: 'bad' } });
      assert.equal(patched.status, 200); assert.equal(patched.data.record.history.length, 2);
      assert.equal((await req(`/crm/records/${task.data.record._id}`, { token, method: 'PATCH', body: { value: 42 } })).status, 200);
      assert.equal((await req(`/crm/records/${project.data.record._id}`, { token, method: 'PATCH', body: { projectId: project.data.record._id } })).status, 400);
      assert.equal((await req('/crm/summary', { token })).data.overdue, 1);
      assert.equal((await req(`/crm/records/${client.data.record._id}`, { token, method: 'PATCH', body: { archived: true } })).status, 200);
      assert.equal((await req('/crm/records?kind=client', { token })).data.total, 0);
      assert.equal((await req('/crm/records?kind=client&archived=true', { token })).data.total, 1);
      assert.equal((await req(`/crm/records/${client.data.record._id}`, { token, method: 'PATCH', body: { archived: false } })).status, 200);
    });
    await t.test('community uploads, display names, concurrent likes, comments and ownership', async () => {
      const fake = new FormData(); fake.append('image', new Blob(['not an image'], { type: 'image/png' }), 'fake.png');
      let result = await fetch(`${base}/community/posts`, { method: 'POST', headers: { Authorization: `Bearer ${regular.idToken}`, 'X-Requested-With': 'CosmoBit' }, body: fake });
      assert.equal(result.status, 400);
      const image = await sharp({ create: { width: 5, height: 5, channels: 3, background: '#ffffff' } }).png().toBuffer();
      const form = new FormData(); form.append('image', new Blob([image], { type: 'image/png' }), 'image.png');
      result = await fetch(`${base}/community/posts`, { method: 'POST', headers: { Authorization: `Bearer ${regular.idToken}`, 'X-Requested-With': 'CosmoBit' }, body: form });
      assert.equal(result.status, 201);
      const { post } = await result.json(); uploaded = post.imageUrl;
      assert.equal(post.authorDisplayName, 'Member Name'); assert.match(post.imageUrl, /\.webp$/);
      const imageResponse = await fetch(`${base.replace('/api', '')}${post.imageUrl}`);
      assert.equal(imageResponse.status, 200); assert.match(imageResponse.headers.get('content-type'), /image\/webp/);
      await Promise.all(Array.from({ length: 4 }, () => req(`/community/posts/${post._id}/like`, { method: 'POST', token, body: {} })));
      const stored = await CommunityPost.findById(post._id); assert.equal(stored.likes.length, 0);
      const comment = await req(`/community/posts/${post._id}/comments`, { method: 'POST', token: regular.idToken, body: { text: 'A comment' } });
      assert.equal(comment.status, 201);
      assert.equal((await req(`/community/posts/${post._id}/comments/${comment.data.comments[0]._id}`, { method: 'DELETE', token, body: {} })).status, 200);
      const outsider = await signup();
      assert.equal((await req(`/community/posts/${post._id}`, { token: outsider.idToken, method: 'DELETE', body: {} })).status, 403);
      assert.equal((await req(`/community/posts/${post._id}`, { token: regular.idToken, method: 'DELETE', body: {} })).status, 200);
      uploaded = null;
    });
    await t.test('contact, newsletter deduplication and rate limits', async () => {
      assert.equal((await req('/contact', { method: 'POST', body: { name: 'Test', email: { $ne: null }, message: 'Hello' } })).status, 400);
      assert.equal((await req('/contact', { method: 'POST', body: { name: 'Test', email: 'test@example.com', message: 'Hello' } })).status, 200);
      assert.equal((await req('/newsletter', { method: 'POST', body: { email: 'test@example.com' } })).status, 200);
      assert.equal((await req('/newsletter', { method: 'POST', body: { email: 'TEST@example.com' } })).status, 200);
      for (let i = 0; i < 4; i++) await req('/contact', { method: 'POST', body: { name: 'Test', email: 'test@example.com', message: 'Hello' } });
      assert.equal((await req('/contact', { method: 'POST', body: { name: 'Test', email: 'test@example.com', message: 'Hello' } })).status, 429);
    });
    await t.test('role changes and Firebase-disabled users take effect immediately', async () => {
      await User.updateOne({ firebaseUid: admin.localId }, { $set: { role: 'user' } });
      assert.equal((await req('/crm/records', { token })).status, 403);
      await firebaseAuth().updateUser(regular.localId, { disabled: true });
      assert.equal((await req('/auth/me', { token: regular.idToken })).status, 401);
    });
  } finally {
    if (uploaded) await fs.unlink(new URL(`..${uploaded}`, import.meta.url)).catch(() => {});
    await Promise.all(uidList.map(uid => firebaseAuth().deleteUser(uid)));
    await new Promise(resolve => server.close(resolve));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
});
