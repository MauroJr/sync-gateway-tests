var launcher = require("../lib/launcher"),
    spawn = require('child_process').spawn,
    coax = require("coax"),
    async = require("async"),
    common = require("../tests/common"),
    conf_file = process.env.CONF_FILE || 'local',
    config = require('../config/' + conf_file),
    utils = common.utils,
    eventEmitter = common.ee,
    emitsdefault = "default",
    test = require("tap").test;

test_time = process.env.TAP_TIMEOUT || 30
test_conf = {timeout: test_time * 1000}


var server,
    dbs = ["cbl-database1", "cbl-database2", "cbl-database3"];

var numDocs = parseInt(config.numDocs) || 100;

var module_name = '\r\n\r\n>>>>>>>>>>>>>>>>>>>' + module.filename.slice(__filename.lastIndexOf(require('path').sep)
        + 1, module.filename.length - 3) + '.js ' + new Date().toString()
console.time(module_name);
console.error(module_name)

test("kill LiteServ", function (t) {
    if (config.provides == "android") {
        spawn('adb', ["shell", "am", "force-stop", "com.couchbase.liteservandroid"])
        setTimeout(function () {
            t.end()
        }, 3000)
    } else {
        t.end()
    }
})

// start client endpoint
test("start test client", test_conf, function (t) {
    var i=1;
    (function loop() {
        common.launchClient(t, function (_server) {
            server = _server
            coax([server, "_session"], function (err, ok) {
                try {
                    if (ok.ok == true) {
                        t.end()
                    } else {
                        return new Error("LiteServ was not run?: " + ok)
                    }
                } catch (err) {
                    console.error(err, "will restart LiteServ..." + i++ +" times")
                    setTimeout(function () {
                        console.log(i)
                        if (i<6) {
                            loop()
                        } else {
                            console.error("can't run LiteServ...")
                            t.end()
                        }
                    }, 9000)
                }
            })
        })
    }());
})

// _session api
test("session api", function (t) {
    console.log(server)
    coax([server, "_session"], function (err, ok) {
        console.log(ok)
        t.equals(ok.ok, true, "api exists")
        t.end()
    })
})

// create valid dbs
test("create valid test databases", function (t) {
    common.createDBs(t, dbs)
})

test("try to create a database with caps", function (t) {
    coax.put([server, "dbwithCAPS"], function (e, js) {
        t.equals(e.status, 400, "db with caps not allowed")
        t.end()
    })
})

test("longdbname", function (t) {
    // try to exceed max db length of 240
    var db = "asfasdfasfasdfasdfasdfasfasjkfhslfkjhalkjfhajkflhskjdfhlkfhajkfheajfkaheflwkjhfawekfhelakjwehflawefhawklejfewhakjfhwaeflakwejfhwaelfhwejflawefhawelfjkhawelfjaeelkfhjaewkfhwaelfhkjwefhawlkejfwaflhewfafjekhwaelfkjahejklfakfdsldlflsldlfkdfszdkf"
    coax.put([server, db], function (e, js) {
        t.equals(e.status, 400, "dbname " + db.length + " is > 240 chars (not allowed)")
        t.end()
    })
})

test("create special char dbs", function (t) {
    var specialdbs = ["un_derscore", "dollar$ign", "left(paren", "right)paren", "c+plus+plus+", "t-minus1", "foward/slash"]
    common.createDBs(t, specialdbs)
})


test("create duplicate db", function (t) {
    coax.put([server, dbs[0]], function (e, js) {
        t.equals(e.status, 412, "db exists")
        t.end()
    })
})

test("db bad name", function (t) {
    coax.put([server, ".*------------------???"], function (err, json) {
        t.equals(err.status, 400, "bad request")
        t.end()
    })
})


test("load a test database", function (t) {
    common.createDBDocs(t, {numdocs: numDocs, dbs: [dbs[0]]})
})

test("verify db loaded", function (t) {
    coax([server, dbs[0]], function (err, json) {
        t.equals(json.doc_count, numDocs, "verify db loaded")
        t.end()
    })
})

// TODO add a more detailed inspection of _active_tasks
test("_active_tasks API", function (t) {
    var db = dbs[0]
    coax([server, "_active_tasks"], function (e, js) {
        if (e) {
            console.log(e)
            t.fail("error calling _active_tasks")
        }
        t.equals(js instanceof Array, true, "verify _active_tasks")
        t.end()
    })
})

test("all docs", function (t) {
    var db = dbs[0]
    coax([server, db, "_all_docs"], function (e, js) {
        if (e) {
            console.log(e)
            t.fail("error calling _all_docs")
        }
        t.equals(js.rows.length, numDocs, "verify _all_docs")
        t.end()
    })
})


test("all docs with keys", function (t) {

    var db = dbs[0]
    coax([server, db, "_all_docs"], function (e, js) {

        // get a subset of all docs
        var keys = js.rows.map(function (row) {
            return row.key
        }).slice(0, numDocs / 5)

        var params = {keys: keys}
        coax.post([server, db, "_all_docs"], params, function (e, js) {

            var resultkeys = js.rows.map(function (row) {
                return row.key
            })

            t.equals(resultkeys.length, numDocs / 5, "verify _all_docs with keys")

            for (var i in keys) {
                if (resultkeys.indexOf(keys[i]) == -1) {
                    t.fail("expected key (" + keys[i] + ") not found in _all_docs")
                }
            }
            t.end()
        })
    })
})

test("compact db", function (t) {
    common.compactDBs(t, [dbs[0]])
})

test("compact during doc update", test_conf, function (t) {
    // start updating docs
    common.updateDBDocs(t, {
        dbs: [dbs[0]],
        numrevs: 5,
        numdocs: numDocs
    })
    // run compaction while documents are updating
    eventEmitter.once("docsUpdating", function () {
        common.compactDBs(t, [dbs[0]], emitsdefault)
    })
})

test("compact during doc delete", test_conf, function (t) {
    // start deleting docs
    common.deleteDBDocs(t, [dbs[0]], numDocs)

    // run compaction while documents are being deleted
    common.compactDBs(t, [dbs[0]], emitsdefault)
})

test("load multiple databases", test_conf, function (t) {
    common.createDBDocs(t, {numdocs: numDocs, dbs: dbs})
})

//issue#149 "Error: socket hang up" when request docs asynchronously
//https://github.com/couchbase/couchbase-lite-android/issues/149#issuecomment-31798402
test("compact during multi-db update", test_conf, function (t) {
    common.updateDBDocs(t, {
        dbs: dbs,
        numrevs: 5,
        numdocs: numDocs
    }, "emit-updated")

    // run compaction while documents are updating
    eventEmitter.once("docsUpdating", function () {
        common.compactDBs(t, dbs, emitsdefault)
    })

    // handle update completes
    eventEmitter.once("emit-updated", function (err, json) {
        if (err) {
            t.fail("errors occured updating docs during compaction: " + err)
        }
        // final compaction
        common.compactDBs(t, dbs)
    })
})


test("verify compaction", test_conf, function (t) {
    common.verifyCompactDBs(t, dbs, numDocs)
})


// purge all dbs
test("test purge", test_conf, function (t) {
    common.purgeDBDocs(t, dbs, numDocs)
})


// verify db purge
test("verify db purge", test_conf, function (t) {
    common.verifyDBPurge(t, dbs)
})


test("can load using bulk docs", test_conf, function (t) {
    common.createDBBulkDocs(t, {numdocs: numDocs * 10, dbs: dbs})
})


// update bulk docs
test("can update bulk docs", function (t) {

    var size = 20
    var db = dbs[0]
    var url = coax([server, db, "_all_docs"]).pax().toString()
    url = url + "?limit=" + size + "&include_docs=true"
    coax(url, function (e, js) {
        if (e) {
            t.fail("unable to get _all_docs")
        }

        var docs = {
            docs: js.rows.map(function (row) {
                return row.doc
            }),
            all_or_nothing: true
        }

        coax.post([server, db, "_bulk_docs"], docs, function (err, results) {
            if (err) {
                console.log(err)
                t.fail("error occurred updating bulk docs")
            }

            t.equals(results.length, size, "updated " + size + " docs")
            t.end()
        })

    })
})


// delete bulk docs
test("can delete bulk docs", function (t) {

    var size = 20
    var db = dbs[0]

    // get doc_count
    coax([server, dbs[0]], function (e, js) {

        var orig_num_docs = js.doc_count

        // get some docs to delete
        var url = coax([server, db, "_all_docs"]).pax().toString()
        url = url + "?limit=" + size + "&include_docs=true"

        coax(url, function (e, js) {
            if (e) {
                t.fail("unable to get _all_docs")
            }

            var docs = {
                docs: js.rows.map(function (row) {
                    row.doc._deleted = true
                    return row.doc
                }),
                all_or_nothing: true
            }

            coax.post([server, db, "_bulk_docs"], docs, function (err, results) {
                if (err) {
                    console.log(err)
                    t.fail("error occurred updating bulk docs")
                }

                t.equals(results.length, size, "deleted" + size + " docs")

                // get num_docs again
                coax([server, dbs[0]], function (e, js) {

                    t.equals(orig_num_docs - size, js.doc_count, "verified " + size + " docs deleted")
                    t.end()
                })
            })

        })

    })
})


test("can't load bulk docs with dupe id's", function (t) {
    var docs = common.generators.bulk(2)

    docs[0] = docs[1]

    coax.post([server, dbs[0], "_bulk_docs"],
        {
            docs: docs,
            all_or_nothing: true
        },
        function (err, json) {
            if (!err) {
                console.log(json)
                t.fail("can post duplicate bulk doc entries?")
                t.end()
                return
            }
            t.equals(err.status, 409, "can post duplicate bulk doc entries")
            t.end()
        })

})


// temp views
test("can run temp view", function (t) {

    if (config.provides == "android") {
        console.log("Skipping temp view on Android")
        t.end()
        return
    }

    var view = {
        map: 'function(doc) { if (doc) { emit(null, doc); } }'
    }

    var url = coax([server, dbs[0], "_temp_view"]).pax().toString()
    url = url + "?limit=" + numDocs

    coax.post(url, view, function (e, js) {
        if (e) {
            console.log(e, " when create view: " + url + " with function: ", view)
            t.false(e, "created tmp view")
            t.end()
            return
        }
        var viewDocs = js.rows.length
        t.equals(viewDocs, numDocs, "temp view returned " + numDocs + " docs")
        t.end()
    })
})


// test _revs_diff
test("verify missing revs", function (t) {

    var db = dbs[0]

    // get a document
    var url = coax([server, db, "_all_docs"]).pax().toString() + "?limit=1"
    coax(url, function (e, js) {
        t.false(e, "retrieved doc")

        var rev = js.rows[0].value.rev
        var id = js.rows[0].id
        var params = {}
        params[id] = [rev]

        coax.post([server, dbs[0], "_revs_diff"], params, function (e, js) {
            t.false(e, "able to query _revs_diff")
            // expect no missing items
            if ('missing' in js) {
                t.fail("existing rev marked as missing")
            }

            // query with missing rev
            var mrev = "99-missingrev"
            params[id].push(mrev)
            coax.post([server, dbs[0], "_revs_diff"], params, function (e, js) {
                t.equals(js[id].missing[0], mrev, "verify missing rev does not exist")
                t.end()
            })
        })

    })

})


test("done", function (t) {
    common.cleanup(t, function (json) {
        t.end()
    }, console.timeEnd(module_name));
});