var launcher = require("../lib/launcher"),
    spawn = require('child_process').spawn,
    coax = require("coax"),
    async = require("async"),
    common = require("../tests/common"),
    util = require("util"),
    cb_util = require("./utils/cb_util"),
    conf_file = process.env.CONF_FILE || 'local',
    config = require('../config/' + conf_file),
    test = require("tap").test,
    test_time = process.env.TAP_TIMEOUT || 30000,
    test_conf = {timeout: test_time * 1000};

var server, sg, gateway,
// local dbs
    dbs = ["api-revisions"];

var numDocs = parseInt(config.numDocs) || 100;
var timeoutReplication = 5000;
if (config.provides == "android" || config.DbUrl.indexOf("http") > -1) timeoutReplication = 500 * numDocs;

var module_name = '\r\n\r\n>>>>>>>>>>>>>>>>>>>' + module.filename.slice(__filename.lastIndexOf(require('path').sep)
        + 1, module.filename.length - 3) + '.js ' + new Date().toString()
console.time(module_name);
console.error(module_name)


test("delete buckets", test_conf, function (t) {
    if (config.DbUrl.indexOf("http") > -1) {
        cb_util.deleteBucket(t, config.DbBucket,
            setTimeout(function () {
                t.end()
            }, timeoutReplication * 10));
    } else {
        t.end()
    }
});

test("create buckets", test_conf, function (t) {
    if (config.DbUrl.indexOf("http") > -1) {
        cb_util.createBucket(t, config.DbBucket, setTimeout(function () {
            t.end();
        }, timeoutReplication * 6));
    } else {
        t.end()
    }
});

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

// kill sync gateway
test("kill syncgateway", function (t) {
    common.kill_sg(t, function () {
        },
        setTimeout(function(){
            t.end();
        }, 2000))
})

// start sync gateway
test("start syncgateway", function(t){
    common.launchSG(t, function(_sg){
        sg  = _sg
        gateway = sg.url
        t.end()
    })
})

// create all dbs
test("create test databases", function (t) {
    common.createDBs(t, dbs)
})

// setup push replication to gateway
test("set push replication to gateway", function (t) {
    var gatewayDB = coax([gateway, config.DbBucket]).pax().toString()
    if (config.provides == "android") gatewayDB = gatewayDB.replace("localhost", "10.0.2.2")
    async.series([
        function (sgpush) {

            async.mapSeries(dbs, function (db, cb) {

                coax([server, "_replicate"]).post({
                    source: db,
                    target: gatewayDB,
                    continuous: true,
                }, function (err, ok) {
                    t.equals(err, null,
                        util.inspect({_replicate: db + " -> " + gatewayDB}))
                    cb(err, ok)
                })

            }, sgpush)
        }/*,
         function(sgpull){

         async.mapSeries(dbs, function(db, cb){

         coax([server, "_replicate"]).post({
         source : gatewayDB,
         target : db,
         continuous : true,
         }, function(err, ok){

         t.equals(err, null,
         util.inspect({_replicate : db+" <- " + gatewayDB}))
         i++
         cb(err, ok)
         })

         }, sgpull)
         }*/], function (err, json) {
        t.false(err, "setup push replication to gateway")
        t.end()
    })

})

test("load databases", test_conf, function (t) {
    common.createDBDocs(t, {numdocs: numDocs, dbs: dbs})
})

test("verify replicated num-docs=" + numDocs, test_conf, function (t) {
    common.verifySGNumDocs(t, [sg], numDocs)
})

test("doc update on SG", test_conf, function (t) {
    // start updating docs
    common.updateSGDocs(t, {
        dbs: [sg],
        numrevs: 1
    })
})


test("doc update on liteServ", test_conf, function (t) {
    // start updating docs
    common.updateDBDocs(t, {
        dbs: dbs,
        numrevs: 1,
        numdocs: numDocs
    })
})


// setup pull replication from gateway
test("set pull replication from gateway", test_conf, function (t) {
    var i = 0;
    var gatewayDB = coax([gateway, config.DbBucket]).pax().toString()
    if (config.provides == "android") gatewayDB = gatewayDB.replace("localhost", "10.0.2.2")
    async.series([
        function (sgpull) {

            async.mapSeries(dbs, function (db, cb) {

                coax([server, "_replicate"]).post({
                    source: gatewayDB,
                    target: db,
                    continuous: true,
                }, function (err, ok) {

                    t.equals(err, null,
                        util.inspect({_replicate: db + " <- " + gatewayDB}))
                    i++;
                    cb(err, ok)
                })

            }, sgpull)
        }], function (err, info) {
        setTimeout(function () {
            t.false(err, "replication created")
            console.log("info", info)
            gatewayDB = coax([gateway, config.DbBucket]).pax().toString()
            coax([gatewayDB, "_all_docs"], function (err, allDocs) {
                t.false(err, "sg database exists")
                t.ok(allDocs, "got _all_docs response")
                console.log("sg doc_count", coax([gatewayDB, "_all_docs"]).pax().toString(), allDocs.total_rows);
                t.equals(allDocs.total_rows, numDocs, "all docs replicated")
                //t.equals(allDocs.update_seq, numDocs*3 + 1, "update_seq correct")
                t.end()
            })
        }, timeoutReplication)
    })

})

test("delete conflicts in docs", test_conf, function (t) {
    common.deleteDBConflictDocs(t, dbs, numDocs)
})

test("verify conflicts deleted in docs", test_conf, function (t) {
    common.verifyNoConflictsDocs(t, dbs, numDocs)
})

test("verify doc revisions 1", test_conf, function (t) {
    //create, update on liteServ( delete & delete conflicts is not included)
    common.verifyDocsRevisions(t, dbs, numDocs, "2-")
})

test("delete db docs 1", test_conf, function (t) {
    common.deleteDBDocs(t, dbs, numDocs)
})

test("load databases", test_conf, function (t) {
    common.createDBDocs(t, {numdocs: numDocs, dbs: dbs})
})

test("update docs", test_conf, function (t) {
    // start updating docs
    common.updateDBDocs(t, {dbs: dbs, numrevs: 5, numdocs: numDocs})
})

test("verify doc revisions 2", test_conf, function (t) {
    //create, update, delete, create, update*5
    common.verifyDocsRevisions(t, dbs, numDocs, "9-")
})

test("delete db docs 2", test_conf, function (t) {
    common.deleteDBDocs(t, dbs, numDocs)
})


test("cleanup cb bucket", test_conf, function (t) {
    if (config.DbUrl.indexOf("http") > -1) {
        coax.post([config.DbUrl + "/pools/default/buckets/" + config.DbBucket + "/controller/doFlush"],
            {
                "auth": {
                    "passwordCredentials": {
                        "username": "Administrator",
                        "password": "password"
                    }
                }
            }, function (err, js) {
                t.false(err, "flush cb bucket")
            },
            setTimeout(function () {
                t.end();
            }, test_time * 2));
    } else {
        t.end();
    }
})

// delete all dbs
test("delete test databases", function(t){
    common.deleteDBs(t, dbs)
    setTimeout(function () {
        t.end()
    }, 6000)
})

test("done", function (t) {
    common.cleanup(t, function (json) {
        sg.kill()
        t.end()
    }, console.timeEnd(module_name));
});
