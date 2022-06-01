const express = require("express");
const {Router} = require("express");
const indexer = require("../indexer");

const app = Router();
module.exports = app;

app.get("/", (req, res) => res.render('dashboard'));

app.get("/count", async (req, res) => {
    res.json({
        all: (await indexer._client.count({ index: indexer.mapping.index, query: { match_all: {} } })).count,
    })
})