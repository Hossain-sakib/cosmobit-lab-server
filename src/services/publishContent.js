import articles from "../../content/editorial-articles.json" with { type: "json" };
import community from "../../content/community-demo.json" with { type: "json" };
import Post from "../models/Post.js";
import User from "../models/User.js";
import CommunityPost from "../models/CommunityPost.js";
import { fields, postFields } from "../lib/validation.js";

/** Add the reviewed content pack once; existing records and real interactions are preserved. */
export async function publishContentPack({ apply = false } = {}) {
  for (const article of articles) {
    fields(article, postFields);
    await new Post(article).validate();
  }
  const summary = {
    mode: apply ? "apply" : "preview",
    articlesAdded: 0,
    profilesAdded: 0,
    discussionsAdded: 0,
    existingSkipped: 0,
  };
  for (const article of articles) {
    if (await Post.exists({ slug: article.slug })) {
      summary.existingSkipped++;
      continue;
    }
    if (apply)
      await Post.create({ ...fields(article, postFields), slug: article.slug });
    summary.articlesAdded++;
  }
  const people = new Map();
  for (const person of community.people) {
    const firebaseUid = `demo-community:${person.id}`;
    let account = await User.findOne({ firebaseUid });
    if (!account) {
      const data = {
        firebaseUid,
        username: person.username,
        displayName: person.name,
        email: `${person.id}@community-demo.example.invalid`,
        emailVerified: false,
        studioSuspended: true,
        isDemo: true,
        role: "user",
        jobTitle: person.headline,
        bio: "Fictional profile used for clearly labelled community sample discussions.",
      };
      account = apply ? await User.create(data) : new User(data);
      summary.profilesAdded++;
    }
    people.set(person.id, account);
  }
  for (const discussion of community.posts) {
    const demoKey = `community-demo:${discussion.key}`;
    if (await CommunityPost.exists({ demoKey })) {
      summary.existingSkipped++;
      continue;
    }
    const author = people.get(discussion.author);
    const identity = (person) => ({
      authorId: person._id,
      authorUsername: person.username,
      authorDisplayName: person.displayName,
      isDemo: true,
    });
    const data = {
      demoKey,
      ...identity(author),
      content: discussion.content,
      likes: [],
      shareCount: 0,
      comments: discussion.comments.map((comment) => ({
        ...identity(people.get(comment.author)),
        text: comment.text,
      })),
    };
    const post = new CommunityPost(data);
    await post.validate();
    if (apply) await post.save();
    summary.discussionsAdded++;
  }
  return summary;
}
