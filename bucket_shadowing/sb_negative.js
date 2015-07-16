var launcher = require("../lib/launcher"),
  coax = require("coax"),
  async = require("async"),
  common = require("../tests/common"),
  util =  require("util"),
  test = require("tap").test,
  test_time = process.env.TAP_TIMEOUT || 60,
  test_conf = {timeout: test_time * 1000},
  cb_util = require("../tests/utils/cb_util"),
  couchbase = require('couchbase');

var server, sg, gateway, app_bucket, shadow_bucket
pulldb = "pull_db",
pushdb = "push_db",
bucketNames = ["app-bucket", "shadow-bucket"]

var sgShadowBucketDb = "http://localhost:4985/db"  
if (config.provides=="android") sgShadowBucketDb = sgShadowBucketDb.replace("localhost", "10.0.2.2");
var timeoutShadowing = 2000;
var timeoutReplication = 5000;
var maxDataSize = 20000000;

test("delete buckets", test_conf, function (t) {
        common.deleteShadowBuckets(t, bucketNames[0], bucketNames[1], setTimeout(function () {
            t.end();
        }, timeoutReplication * 10));
});

test("create buckets", test_conf, function (t) {
    if (config.DbUrl.indexOf("http") > -1) {
        cb_util.createBucket(t, bucketNames[0])
        cb_util.createBucket(t, bucketNames[1], setTimeout(function () {
            t.end();
        }, timeoutReplication * 6));
    } else {
        t.end()
    }
});

test("start test client", test_conf, function(t){
  common.launchClient(t, function(_server){
    server = _server
    setTimeout(function () {
        t.end()
    }, timeoutReplication*2)
  })
})

test("start sync_gateway", function(t){
  common.launchSGShadowing(t, function(_sg){
    sg  = _sg
    gateway = sg.url
    t.end()
  })
})

test("create app_bucket connection", function(t){
    app_bucket = new couchbase.Cluster('127.0.0.1:8091').openBucket(bucketNames[0], function(err) {
        if (err) {
            // Failed to make a connection to the Couchbase cluster.
            throw err;
        } else{
            t.end();
        }
    })
})

test("create shadow_bucket connection", function(t){
    shadow_bucket = new couchbase.Cluster('127.0.0.1:8091').openBucket(bucketNames[1], function(err) {
        if (err) {
            // Failed to make a connection to the Couchbase cluster.
            throw err;
        } else{
            t.end();
        }
    })
})

test("create test database " + pulldb, function(t){
    common.createDBs(t, [ pulldb ])
    setTimeout(function () {
        t.end()
    }, timeoutReplication)
})

test("create both push lite db " , function(t){
  common.createDBs(t, [ pushdb ])
  t.end()
})

test("Mobile client start continous pull replication", function(t) {
    console.log("===== Web client to start pull replication url:" + coax([server, "_replicate"]).pax().toString(), "source:", sgShadowBucketDb, ">>  target:", pulldb)
    coax.post([server, "_replicate"], {
        source : sgShadowBucketDb,
        target : pulldb,
        continuous : true
    }, function(err, info) {
        t.false(err, "create continous pull replication. error: " + JSON.stringify(err))
        t.end()
    });    
});

test("Mobile client start continous push replication", function(t) {
    console.log("===== Web client to start pull replication url:" + coax([server, "_replicate"]).pax().toString(), "source:", sgShadowBucketDb, ">>  target:", pulldb)
    coax.post([server, "_replicate"], {
        source : pushdb,
        target : sgShadowBucketDb,
        continuous : true
    }, function(err, info) {
        t.false(err, "create continous push replication. error: " + JSON.stringify(err))
        t.end()
    });    
});

test("Adding an over-sized document to app-bucket and verify it is not shadowed", function(t) {
    var docId = "testdoc_over_max_size";
    var data = (new Array(maxDataSize - 319 )).join("x")  //320 is the size of additional data SG craeted for the doc
    var value = {k : data};
    app_bucket.upsert(docId, JSON.stringify( value ), function(err, result) {
        if (err) {
            t.fail("Fail to create document " + docId + " in app_bucket. err: " + JSON.stringify(err))
            throw err;
            cb(err, result)
        } else {
            t.ok(!err, "Document " + docId + " created successfully on app_bucket")
            setTimeout(function () {
                // Check the doc is created in app_bucket successfully
                app_bucket.get(docId, function(error, result) {
                    if (error) {
                        t.fail(error, "over-sized doc was not created in app-bucket.  error:" + JSON.stringify(error))
                        t.end()
                    } else {
                        t.ok(!error, "over-sized doc was created in app-bucket.  error:" + JSON.stringify(error))
                        // Check the doc is not shadowed to shadow bucket 
                        shadow_bucket.get(docId, function(err, result) {
                            if (error) {
                                t.fail(error, "over-sized doc was not supposed to shadowed to shadow-bucket.  error:" + JSON.stringify(err))
                            }
                            t.end()
                        }); 
                    }    
                });    
            }, timeoutShadowing ) 
        }
    });            
});

test("Adding an empty document to app-bucket and verify it is not shadowed", function(t) {
    var docId = "testdoc_empty";
    var value = "";
    app_bucket.upsert(docId, value, function(err, result) {
        if (err) {
            t.fail("Fail to create document " + docId + " in app_bucket. err: " + JSON.stringify(err))
            throw err;
            cb(err, result)
        } else {
            t.ok(!err, "Document " + docId + " created successfully on app_bucket")
            setTimeout(function () {
                // Check the doc is created in app_bucket successfully
                app_bucket.get(docId, function(error, result) {
                    if (error) {
                        t.fail(error, "empty doc was not created in app-bucket.  error:" + JSON.stringify(error))
                        t.end()
                    } else {
                        t.ok(!error, "empty doc was created in app-bucket.  error:" + JSON.stringify(error))
                        // Check the doc is not shadowed to shadow bucket 
                        shadow_bucket.get(docId, function(err, result) {
                            t.ok(err, "empty doc was not supposed to shadowed to shadow-bucket.  error:" + JSON.stringify(err))
                            t.end()
                        }); 
                    }    
                });    
            }, timeoutShadowing ) 
        }
    });            
});

test("Adding an non-json document to app-bucket and verify it is not shadowed", function(t) {
    var docId = "testdoc_non_json";
    var value = "aaaa";
    app_bucket.upsert(docId, value, function(err, result) {
        if (err) {
            t.fail("Fail to create document " + docId + " in app_bucket. err: " + JSON.stringify(err))
            throw err;
            cb(err, result)
        } else {
            t.ok(!err, "Document " + docId + " created successfully on app_bucket")
            setTimeout(function () {
                // Check the doc is created in app_bucket successfully
                app_bucket.get(docId, function(error, result) {
                    if (error) {
                        t.fail(error, "Non-json doc was not created in app-bucket.  error:" + JSON.stringify(error))
                        t.end()
                    } else {
                        t.ok(!error, "Non-json doc was created in app-bucket.  error:" + JSON.stringify(error))
                        // Check the doc is not shadowed to shadow bucket 
                        shadow_bucket.get(docId, function(err, result) {
                            t.ok(err, "Non-json doc was not supposed to shadowed to shadow-bucket.  error:" + JSON.stringify(err))
                            t.end()
                        }); 
                    }    
                });    
            }, timeoutShadowing ) 
        }
    });            
});

test("delete buckets", function (t) {
    common.deleteShadowBuckets(t, bucketNames[0], bucketNames[1], setTimeout(function () {
        t.end();
    }, timeoutReplication * 5));
});

test("done", function(t){
  common.cleanup(t, function(json){
    sg.kill()
    app_bucket.disconnect();
    shadow_bucket.disconnect();
    t.end()
  })
})