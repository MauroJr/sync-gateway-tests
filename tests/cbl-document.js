var launcher = require("../lib/launcher"),
  coax = require("coax"),
  async = require("async"),
  tstart = process.hrtime(),
  common = require("../tests/common"),
  conf_file = process.env.CONF_FILE || 'local',
  config = require('../config/' + conf_file),
  utils = common.utils,
  ee = common.ee,
  emitsdefault  = "default",
  test = require("tap").test;

var server,
 dbs = ["api-test1", "api-test2", "api-test3"];

var numDocs=config.numDocs || 100;

// start client endpoint
test("start test client", function(t){
  common.launchClient(t, function(_server){
    server = _server
    t.end()
  })
})

test("create test databases", function(t){
  common.createDBs(t, dbs)
})

//issue#150 request doc attachment by name returns status instead of content
test("create docs with inline text attachments", function(t){
  common.createDBDocs(t, {numdocs : numDocs,
                          dbs : dbs,
                          docgen : 'inlineTextAtt'}, 'emits-created')

  ee.once('emits-created', function(e, js){
    t.false(e, "created docs with inline text attachments")

    // get doc
    coax([server, dbs[0], "_all_docs", {limit : 1}], function(e, js){
      if(e){
        console.log(e)
        t.fail("unable to retrieve doc from all_docs")
      }

      // get doc with attachment info
      var docid = js.rows[0].id
      coax([server, dbs[0], docid, { attachments : true }], function(e, js){

        if(e){
          console.log(e)
          t.fail("read doc failed")
        }

        // get just attachment
        var doctext = js.text
        var attchid = Object.keys(js._attachments)[0]
        coax([server, dbs[0], docid, attchid], function(err, response){
            if (err){
                console.log(err)
                t.false(err, "retrieved doc with attachment")
            }else{
              // search for cblite string
                var url = coax([server, dbs[0], docid, attchid]).pax().toString()
                if (response.constructor ==  String) {
                    t.ok(doctext == response, "verify data with inline text attachments for " + url +
                            ". Expected:'" + doctext +"' but got:" + response)
                } else {
                    var rsp = JSON.stringify(response)
                    t.ok(doctext == response, "verify data with inline text attachments for " + url +
                        ". Expected:'" + doctext +"' but got:" + rsp)
                }
          }
          t.end()
        })
      })
    })
  })
})

// issue#76 couchbase-lite-android: _purge api needs implementing
// { error: 'not_found', reason: 'CBLRouter unable to route request to
// do_POST_Document_purge' }
// purge all dbs
test("test purge", function(t){
  common.purgeDBDocs(t, dbs, numDocs)

})

//issue#150 request doc attachment by name returns status instead of content
//note: 'test purge' should pass otherwise the first item in array _attachments will be inline.txt
test("create docs with image attachments", function(t){

 common.createDBDocs(t, {numdocs : numDocs,
                          dbs : dbs,
                          docgen : 'inlinePngtAtt'}, 'emits-created')

  ee.once('emits-created', function(e, js){

    t.false(e, "created docs with image attachments")

    // get doc
    coax([server, dbs[0], "_all_docs", {limit : 1}], function(e, js){

      if(e){
        console.log(e)
        t.fail("unable to retrieve doc from all_docs")
      }

      // get doc with attachment info
      var docid = js.rows[0].id
      coax([server, dbs[0], docid, { attachments : true }], function(e, js){

        if(e){
          console.log(e)
          t.fail("read doc failed")
        }

        // get just attachment
        var doctext = js.text
        var attchid = Object.keys(js._attachments)[0]
        coax([server, dbs[0], docid, attchid], function(e, response){

          // search for cblite string
          t.false(e, "retrieved doc with image attachment")
          	var url = coax([server, dbs[0], docid, attchid]).pax().toString()
            if (response.constructor ==  String) {
                t.ok(rsp == "PNG", "verify img attachment. Got response from " + url +":" + response)
            } else {
                var rsp = JSON.stringify(response)
                t.fail("requst of image is not String. Got response from " + url +":" + rsp)
            }
            t.end()
        })
      })
    })	
  })
})


test("multi inline attachments", function(t){

 common.updateDBDocs(t, {numdocs : numDocs,
                         numrevs : 3,
                         dbs : dbs,
                         docgen : 'inlineTextAtt'}, 'emits-updated')

  ee.once('emits-updated', function(e, js){

    t.false(e, "added attachment to docs")

    // get doc
    coax([server, dbs[0], "_all_docs", {limit : 1}], function(e, js){

      if(e){
        console.log(e)
        t.fail("unable to retrieve doc from all_docs")
      }

      // get doc with attachment info
      var docid = js.rows[0].id
      coax([server, dbs[0], docid, { attachments : true }], function(e, js){
        if(e){
          console.log(e)
          t.fail("read doc failed")
        }

        // verify text attachment
        var doctext = js.text
        var attchid = Object.keys(js._attachments)[1]
        coax([server, dbs[0], docid, attchid], function(err, response){
            if (err){
                console.log(err)
              t.false(err, "retrieved doc with attachment")
            }else{
                // search for cblite string
                t.ok(doctext == response, "verify attachment data")
            }
          t.end()
        })
      })
    })

  })
})


// compact db
test("compact db", function(t){
  common.compactDBs(t, dbs)

})

// expecting compacted revs to be 'missing'
test("verify compaction", function(t){
  common.verifyCompactDBs(t, dbs, numDocs)
})

test("delete doc attachments", function(t){
  common.deleteDBDocAttachments(t, dbs, numDocs)
})

test("delete db docs", function(t){
  common.deleteDBDocs(t, dbs, numDocs)
})

test("create attachments using bulk docs", function(t){
  common.createDBBulkDocs(t, {numdocs : numDocs*10,
                              docgen : 'bulkInlineTextAtt',
                              dbs : dbs})
})

test("verify db loaded", function(t){
  coax([server, dbs[0]], function(err, json){
    t.equals(json.doc_count, numDocs*10, "verify db loaded")

    // get doc
    coax([server, dbs[0], "_all_docs", {limit : 1}], function(e, js){

      if(e){
        console.log(e)
        t.fail("unable to retrieve doc from all_docs")
      }

      // get doc with attachment info
      var docid = js.rows[0].id
      coax([server, dbs[0], docid, { attachments : true }], function(e, js){

        if(e){
          console.log(e)
          t.fail("read doc failed")
        }

        // get just attachment
        var doctext = js.text
        var attchid = Object.keys(js._attachments)[0]
        coax([server, dbs[0], docid, attchid], function(e, response){

          // search for cblite string
          t.false(e, "retrieved doc with attachment")
          t.ok(doctext == response, "verify attachment data")
          t.end()
        })
      })
    })

  })
})

test("docs with bad fields", function(t) {
  coax.post([server, dbs[0]], {"_foo" : "not cool"}, function(err, ok){
    t.ok(err, "_underscore fields should not be allowed")
    t.end()
  })
})

test("delete doc with _delete", function(t){

  var doc = { _id : "hello" }
  coax.post([server, dbs[0]], doc, function(err, js){
    doc = js
    doc._rev = js.rev
    doc._id = js.id
    doc._deleted = true
    coax.post([server, dbs[0]], doc, function(err, _js){
      t.false(err)
      coax([server, dbs[0], "hello"], function(err, _js){
	  if (typeof err.status == 'undefined'){
	      console.log(err)
	      t.fail("err.status code missed")
	  }else{
	      t.equals(err.status, 404, "doc missing")
	  }
        t.end()
      })
    })
  })
})

// X multi attachments (inline | external)

// X update attachments (inline | external)

// X delete attachments (inline | external)

// X bulkdoc attachments (inline | external)

// bulkdoc multi attachments (inline | external)

// update bulkdoc multi attachments (inline | external)

// get changed attachments

// X compact (inline | external)

test("create basic local docs", function(t){

  common.createDBDocs(t, {numdocs : numDocs,
                          dbs : dbs,
                          docgen : 'basic',
                          localdocs : '_local'}, 'emits-created')

  ee.once('emits-created', function(e, js){
    t.false(e, "created basic local docs")

    // get doc
    coax([server, dbs[0], "_local", dbs[0]+"_0"], function(e, js){


      if(e){
        console.log(e)
        t.fail("unable to retrieve local doc:"+ dbs[0] + "/_local/" + dbs[0]+"_0")
      }

      // get doc with attachment info
      var docid = js._id
      coax([server, dbs[0], docid, { attachments : true }], function(e, js){

        if(e){
          console.log(e)
          t.fail("read local doc with basic data")
        }

        if (typeof js._attachments != 'undefined') {
        	t.fail("local doc " + js._id + " stores attachment", js)
        	t.end()
        	return
        }
        var docdata=js.data
        if (typeof docdata == 'undefined'){
            t.fail("js.data missed in js:" + js)
        } else
            t.ok(docdata.length == Math.random().toString(5).substring(4).length, "verify attachment data")
        t.end()
        })
      })
    })
  })

test("delete local db docs",  function(t){
  common.deleteDBDocs(t, dbs, numDocs, "_local")
})

//local docs do not support attachments and an error needs to be thrown when try to store with attachments

// big docs

// bad ids

// nonjson data

// doc expire

test("done", function(t){
  common.cleanup(t, function(json){
    t.end()
  })

})