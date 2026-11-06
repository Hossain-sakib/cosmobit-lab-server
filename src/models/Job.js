import mongoose from "mongoose";

const jobSchema = new mongoose.Schema(
  {
    archived: { type: Boolean, default: false },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    history: [{ _id:false, at:Date, actor:mongoose.Schema.Types.ObjectId, action:String, fields:[String] }],
    title: { type: String, required: true, trim: true },
    department: { type: String, required: true, trim: true },
    location: { type: String, default: "Remote" },
    type: { type: String, enum: ["Full-time", "Part-time", "Contract", "Internship"], default: "Full-time" },
    description: { type: String, required: true },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: {transform(doc,ret){ret.version=ret.__v;return ret;}} }
);

export default mongoose.model("Job", jobSchema);
