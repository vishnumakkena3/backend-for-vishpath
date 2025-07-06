// models/User.model.js
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema({
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['student', 'admin'], default: 'student' },
    profile: {
      fullName: String,
      age: Number,
      educationLevel: String,
      academicBackground: {
        stream: String,
        subjects: [{
          name: String,
          marks: Number
        }],
        GPA: Number,
        totalMarks: Number,
        percentage: Number
      },
      careerInterests: [String],
      skills: [String],
      workExperience: [{
        role: String,
        company: String,
        duration: String
      }]
    }
  });

userSchema.pre("save", async function (next) {
    if(this.isModified("password")){
        this.password = await bcrypt.hash(this.password, 10);
    }
    next();
});

userSchema.methods.comparePassword = async function (password) {
    return await bcrypt.compare(password, this.password);
}

module.exports = mongoose.model("User", userSchema);