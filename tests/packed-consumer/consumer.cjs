const schemaStream = require("schema-stream")

if (typeof schemaStream.SchemaStream !== "function") {
  throw new Error("schema-stream packed CommonJS export mismatch")
}

console.log("packed CommonJS export passed")
