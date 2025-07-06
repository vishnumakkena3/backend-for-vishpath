const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const User = require("./models/User.model.js");
const cors = require("cors");
const bodyParser = require("body-parser");
const verifyToken = require("./middlewares/auth.middleware");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI("AIzaSyAZuCP3GBsq3T67OaDQYeYPTvhPCNEuX1c");

const mongoose = require("mongoose");
const uri =
  "mongodb+srv://appuser:appuser@cluster0.htkfmfw.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";

async function run() {
  try {
    await mongoose.connect(uri);
    await mongoose.connection.db.admin().command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } catch (err) {
    console.log("Error occurred while connecting to MongoDB server", err);
  }
}
run();

const app = express();
app.use(cors());
app.use(bodyParser.json());
const SECRET_KEY = "123456789";

app.post("/signup", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }
  try {
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res
        .status(400)
        .json({ error: "Email already exists! Use login option" });
    }
    const user = new User({ email, password });
    await user.save();
    res.status(201).json({ message: "User created successfully" });
  } catch (err) {
    res.status(500).json({ error: "Internal server error:" });
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    // Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    // Compare passwords
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    // Generate JWT
    const token = jwt.sign({ id: user._id, email: user.email }, SECRET_KEY, {
      expiresIn: "1h",
    });

    res.json({ token });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get("/protected", (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    res.json({ message: "You are authenticated", user: decoded });
  } catch (err) {
    res.status(401).json({ error: "Invalid token" });
  }
});

app.get("/profile", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password");
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json(user.profile);
  } catch (err) {
    res.status(500).json({ error: "Server error" });
  }
});

app.patch("/profile", verifyToken, async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: { profile: req.body } },
      { new: true }
    ).select("-password");
    res.json(user.profile);
  } catch (err) {
    res.status(500).json({ error: "Server error", message: err });
  }
});

const chatCache = {}; // Initialize chatCache

app.post("/chatbot", verifyToken, async (req, res) => {
  const { message, history } = req.body;
  if (!message?.trim()) {
    return res.status(400).json({ error: "Valid message is required" });
  }

  try {
    const user = await User.findById(req.user.id).select("profile");
    if (!user?.profile) {
      return res.status(400).json({ error: "User profile not found" });
    }

    const { educationLevel, academicBackground, careerInterests, skills } =
      user.profile;
    if (
      !educationLevel ||
      !academicBackground?.subjects ||
      !careerInterests ||
      !skills
    ) {
      return res.status(400).json({ error: "Incomplete profile" });
    }

    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const userId = req.user.id;

    let chat = chatCache[userId];
    if (!chat) {
      chat = model.startChat({
        history: [
          {
            role: "user",
            parts: [
              {
                text: `You are a career advisor. The user is a ${educationLevel} student with the following details:
                  - Subjects: ${academicBackground.subjects.join(",")}
                  - Career Interests: ${careerInterests.join(",")}
                  - Skills: ${skills.join(",")}.
                  Kindly avoid answering any questions other than the education related doubts, but reply to the user's queries and general greetings or wishes.`,
              },
            ],
          },
        ],
      });
      chatCache[userId] = chat;
    }

    // Ensure chat.history is an array
    if (!chat.history) {
      chat.history = [];
    }

    // Limit history size
    const safeHistory = Array.isArray(history) ? history.slice(-10) : [];
    chat.history = [...chat.history.slice(-10), ...safeHistory];

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const result = await chat.sendMessageStream(message);
    let fullResponse = "";

    try {
      for await (const chunk of result.stream) {
        const chunkText = chunk.text();
        fullResponse += chunkText;
        res.write(`data: ${JSON.stringify({ text: chunkText })}\n\n`);
      }

      // Push new messages to chat history
      chat.history.push(
        { role: "user", parts: [{ text: message }] },
        { role: "model", parts: [{ text: fullResponse }] }
      );
      res.end();
    } catch (streamErr) {
      result.stream.cancel();
      if (!res.headersSent) {
        res.status(500).json({ error: "Stream error" });
      } else {
        res.write(`data: ${JSON.stringify({ error: "Stream error" })}\n\n`);
        res.end();
      }
    }
  } catch (err) {
    console.error("Chat error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Chat failed" });
    } else {
      res.write(`data: ${JSON.stringify({ error: "Chat failed" })}\n\n`);
      res.end();
    }
  }
});

app.post("/career_prediction", verifyToken, async (req, res) => {
  const {
    partTimeJob,
    absenceDays,
    extracurricularActivities,
    weeklySelfStudyHours,
    learningStyle,
    careerGoals,
    studentPreferredField,
    parentPreferredField,
    financialSupport,
    teacherRecommendedField,
    personalityType,
    stressHandling,
    interestAreas,
    observedStrengths,
  } = req.body;

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    console.log(interestAreas);
    const formattedInterestAreas = Object.entries(interestAreas)
      .map(([area, rating]) => {
        const formattedArea = area
          .replace(/([A-Z])/g, " $1")
          .replace(/^./, (str) => str.toUpperCase());
        return `${formattedArea}: ${rating}`;
      })
      .join(", ");
    let prompt = `Based on the following information, suggest a suitable career path:
Student Background:
- Part-time job: ${partTimeJob}
- Absence days: ${absenceDays}
- Extracurricular activities: ${extracurricularActivities}
- Weekly self-study hours: ${weeklySelfStudyHours}

Academic and Career Preferences:
- Learning style: ${learningStyle}
- Career goals: ${careerGoals}
- Student's preferred field: ${studentPreferredField}
- Parent's preferred field: ${parentPreferredField}
- Financial support level: ${financialSupport}
- Teacher's recommended field: ${teacherRecommendedField}

Personal Attributes:
- Personality type: ${personalityType}
- Stress handling capability: ${stressHandling}
- Observed strengths: ${observedStrengths.join(", ")}

Interest Areas (Rated out of 5):
${formattedInterestAreas}

Please provide:
1. Primary career recommendation with detailed explanation of why it's suitable
2. Specific steps to pursue this career path
3. Three alternative career paths that align with the student's profile
4. Additional skills to develop for success in these fields`;

    const result = await model.generateContent(prompt);
    const prediction = result.response.text();
    console.log(prompt);
    res.json({ recommendation: prediction });
  } catch (error) {
    console.error("Career prediction error:", error);
    res.status(500).json({ error: "Failed to generate career prediction" });
  }
});

const PORT = 3001;
app.listen(PORT, () =>
  console.log(`Server running on http://localhost:${PORT}`)
);
