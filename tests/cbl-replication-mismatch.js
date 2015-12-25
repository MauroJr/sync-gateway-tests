var launcher = require("../lib/launcher"),
  coax = require("coax"),
  async = require("async"),
  common = require("../tests/common"),
  util =  require("util"),
  test = require("tap").test,
  test_time = process.env.TAP_TIMEOUT || 30000,
  test_conf = {timeout: test_time * 1000};

var numDocs=(parseInt(config.numDocs) || 100)*5;

var server, sg, gateway, sgdb
  // local dbs
 dbs = ["mismatch-test-one", "mismatch-test-two"];

var module_name = '\r\n\r\n>>>>>>>>>>>>>>>>>>>' + module.filename.slice(__filename.lastIndexOf(require('path').sep)
        + 1, module.filename.length - 3) + '.js ' + new Date().toString()
console.time(module_name);
console.error(module_name)

// start client endpoint
test("start test client", function (t) {
  common.launchClient(t, function (_server) {
    server = _server
    coax([server, "_session"], function (err, ok) {
      try {
        console.error(ok)
        t.equals(ok.ok, true, "api exists")
      } catch (err) {
        console.error(err, "will restart LiteServ...")
        common.launchClient(t, function (_server) {
          server = _server
        }, setTimeout(function () {
          t.end();
        }, 3000))
      } finally {
        t.end()
      }
    })
  })
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
test("create test databases", function(t){
  common.createDBs(t, dbs)
})


test("setup continuous push and pull from both client database", function(t) {
  sgdb = sg.db.pax().toString()
  if (config.provides=="android") sgdb = sgdb.replace("localhost", "10.0.2.2")

  // sgdb = "http://sync.couchbasecloud.com:4984/guestok64"

  common.setupPushAndPull(server, dbs[0], sgdb, function(err, ok){
    t.false(err, 'replication one ok')
    common.setupPushAndPull(server, dbs[1], sgdb, function(err, ok){
      t.false(err, 'replication two ok')
      t.end()
    })
  })
})

test("load databases", test_conf, function(t){
  t.equals(numDocs/2, Math.floor(numDocs/2), "numDocs must be an even number")
  common.createDBDocs(t, {numdocs : numDocs/2, dbs : dbs, docgen : "channels"})
})

test("verify dbs have same number of docs", test_conf, function(t) {
  common.verifyNumDocs(t, dbs, numDocs)
})

var sg_doc_ids;
test("verify sync gateway changes feed has all docs in it", test_conf, function(t) {
  var db = coax(sg.db.pax().toString())
  db("_changes", function (err, data) {
    var changes = data.results.map(function(r){return r.id});
    db("_all_docs", function(err, view){
      var docs = view.rows;
      var missing = [];

      docs.forEach(function(d){
        if (changes.indexOf(d.id) == -1) {
          missing.push(d.id)
        }
      })

      var changeIds = {}, dupIds = [];
      var changeSeqs = {}, dupSeqs = [];

      data.results.forEach(function(r){
        if (changeIds[r.id]) {
          dupIds.push(r.id)
        }
        changeIds[r.id] = true

        if (changeSeqs[r.seq]) {
          dupSeqs.push(r.seq)
        }
        changeSeqs[r.seq] = true
      })

      t.equals(docs.length, numDocs, "correct number of docs in _all_docs")
      //t.equals(changes.length, numDocs + 1, "correct number of docs in _changes")
      t.equals(dupIds.length, 0, "duplicate ids in changes")
      t.equals(dupSeqs.length, 0, "duplicate seqs in changes")
      t.equals(0, missing.length, "missing changes")

      console.log("missing "+missing.length+", ids:", missing.join(', '))
      console.log("duplicate change ids "+dupIds.length+", ids:", dupIds.join(', '))
      console.log("duplicate change seqs "+dupSeqs.length+", seqs:", dupSeqs.join(', '))

      t.end()
    })

  })

})

test("verify cbl changes", function(t){
  common.verifyChanges(coax([server, dbs[0]]), function(db_one_ids, db_one_dup_ids, db_one_seqs,db_one_dup_seqs) {
    var one_ids_list = Object.keys(db_one_ids), db_one_seqs_list = Object.keys(db_one_seqs)
    t.equals(one_ids_list.length, numDocs, "correct number of docs in _all_docs")
    t.equals(db_one_seqs_list.length, numDocs, "correct number of docs in _changes")
    t.equals(db_one_dup_ids.length, 0, "duplicate ids in changes " + db_one_dup_ids)
    t.equals(db_one_dup_seqs.length, 0, "duplicate seqs in changes")

    common.verifyChanges(coax([server, dbs[0]]), function(db_two_ids, db_two_dup_ids, db_two_seqs,db_two_dup_seqs) {
      var db_two_idslist = Object.keys(db_two_ids), db_two_seqs_list = Object.keys(db_two_seqs)

      t.equals(db_two_idslist.length, numDocs, "correct number of docs in _all_docs")
      t.equals(db_two_seqs_list.length, numDocs, "correct number of docs in _changes")
      t.equals(db_two_dup_ids.length, 0, "duplicate ids in changes")
      t.equals(db_two_dup_seqs.length, 0, "duplicate seqs in changes")

      var missing_from_one =[], missing_from_two=[]
      for (var i = db_two_idslist.length - 1; i >= 0; i--) {
        if (!db_one_ids[db_two_idslist[i]]) {
          missing_from_one.push(db_two_idslist[i])
        }
      };
      for (var i = one_ids_list.length - 1; i >= 0; i--) {
        if (!db_two_ids[one_ids_list[i]]) {
          missing_from_two.push(one_ids_list[i])
        }
      };
      t.equals(0, missing_from_one.length, "missing changes in one " + missing_from_one.join())
      t.equals(0, missing_from_two.length, "missing changes in two" + missing_from_two.join())
      t.end()
    })
  })
})

test("cleanup cb bucket", test_conf, function(t){
    if (config.DbUrl.indexOf("http") > -1){
    coax.post([config.DbUrl + "/pools/default/buckets/" + config.DbBucket + "/controller/doFlush"],
	    {"auth":{"passwordCredentials":{"username":"Administrator", "password":"password"}}}, function (err, js){
	      t.false(err, "flush cb bucket")
	    },
	    setTimeout(function(){
		 t.end();
	            }, test_time * 2));
	}else{
	    t.end();
	}
})

// delete all dbs
test("delete test databases", function(t){
  common.deleteDBs(t, dbs)
})

test("done", function(t){
  common.cleanup(t, function(json){
    sg.kill()
    t.end()
  }, console.timeEnd(module_name));
});
