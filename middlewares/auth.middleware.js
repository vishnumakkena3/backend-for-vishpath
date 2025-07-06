// middlewares/auth.middleware.js
const jwt = require("jsonwebtoken");
const SECRET_KEY = "123456789";
const verifyToken = (req, res, next)=>{
    const token = req.headers.authorization?.split(" ")[1];
    if(!token){
        return res.status(401).json({error: "No token provided"});
    }
    try{
        const decoded = jwt.verify(token, SECRET_KEY);
        req.user = decoded;
        next();
    }catch(err){
        res.status(401).json({error: "Invalid token"});
    }
};
module.exports = verifyToken;