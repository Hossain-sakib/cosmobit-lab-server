import dotenv from "dotenv";
import { connectDB } from "./config/db.js";

import Post from "./models/Post.js";
import Job from "./models/Job.js";
import mongoose from "mongoose";

dotenv.config();

async function seed() {
  await connectDB();

  // --- Sample blog posts ---
  const postCount = await Post.countDocuments();
  if (postCount === 0) {
    await Post.insertMany([
      {
        title: "Why we scope projects in weeks, not story points",
        slug: "scope-projects-in-weeks",
        excerpt: "Story points are great for a team's internal rhythm — terrible for telling a client when they'll actually launch.",
        content:
          "Story points are great for a team's internal rhythm and terrible for telling a client when they'll actually launch.\n\nWhen we started CosmoBit Labs, we tried running every engagement the way we'd run an internal product team: sprints, points, velocity charts. Clients nodded politely and then asked the same question every retro — \"so when does this ship?\"\n\nNow every proposal is scoped in calendar weeks tied to a visible milestone, not points tied to an invisible chart. It forces us to be honest about scope up front, and it gives clients something they can actually plan around.",
        category: "Process",
        author: "Maya Chen",
        coverVariant: "blue",
      },
      {
        title: "Shipping a React Native app in ten weeks",
        slug: "react-native-in-ten-weeks",
        excerpt: "A field guide to the decisions that actually move a cross-platform launch date, and the ones that just feel productive.",
        content:
          "A field guide to the decisions that actually move a cross-platform launch date, and the ones that just feel productive.\n\nMost of the time lost on a mobile build isn't in the code — it's in app store review cycles, push notification certificates, and the two days nobody budgets for App Store screenshots.\n\nWe now start store submissions in week one, not week nine. By the time the app is feature-complete, the boring infrastructure around it is already done.",
        category: "Engineering",
        author: "Noah Kim",
        coverVariant: "purple",
      },
      {
        title: "Retrieval-augmented generation, without the hype",
        slug: "rag-without-the-hype",
        excerpt: "What RAG is actually good at, where it quietly falls apart, and how we evaluate it before it touches production.",
        content:
          "What RAG is actually good at, where it quietly falls apart, and how we evaluate it before it touches production.\n\nRAG is not a substitute for good information architecture. If your internal docs are a mess, a retrieval layer will confidently retrieve the mess.\n\nBefore we ship any AI feature, we build a small evaluation set of real questions with known-good answers, and we re-run it after every prompt or retrieval change. It's unglamorous and it's the only thing that's actually saved us from shipping a confidently wrong assistant.",
        category: "AI",
        author: "Lena Novak",
        coverVariant: "blue",
      },
    ]);
    console.log("Seeded 3 sample blog posts.");
  } else {
    console.log("Posts already exist — skipping.");
  }

  // --- Sample job postings ---
  const jobCount = await Job.countDocuments();
  if (jobCount === 0) {
    await Job.insertMany([
      {
        title: "Senior Frontend Engineer",
        department: "Engineering",
        location: "Remote (US/EU overlap)",
        type: "Full-time",
        description:
          "You'll build client-facing product UI in React and TypeScript, work directly with designers, and help junior engineers level up on code review.",
      },
      {
        title: "Product Designer",
        department: "Design",
        location: "Remote",
        type: "Full-time",
        description:
          "Own design from early wireframes through developer handoff on 2-3 concurrent client projects. Portfolio with shipped product work required.",
      },
      {
        title: "Backend Engineering Intern",
        department: "Engineering",
        location: "Remote",
        type: "Internship",
        description:
          "A 12-week paid internship pairing you with a senior backend engineer on real client API and infrastructure work — not busywork.",
      },
    ]);
    console.log("Seeded 3 sample job postings.");
  } else {
    console.log("Jobs already exist — skipping.");
  }

  await mongoose.disconnect();
  console.log("Done.");
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
