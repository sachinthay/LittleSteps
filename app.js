var express = require('express');
var app = express();
var session = require('express-session');
var conn = require('./dbConfig')
app.set('view engine','ejs');

app.use(session({
  secret :'yoursecret',
  resave : true,
  saveUninitialized : true
}));

// Middleware to parse incoming form data
app.use(express.urlencoded({ extended: true }));  // Parses URL-encoded bodies (form data)
app.use(express.json());  // Parses JSON bodies

app.use('/public', express.static('public')); // use public folder

app.get('/', function (req, res){
  let userRole = req.session.userRole || 'guest';
res.render("home", { userRole: userRole });
});

app.get('/aboutUs', function (req, res){
  let userRole = req.session.userRole || 'guest';
  res.render("aboutUs", { userRole: userRole });
});

app.get('/enrolment', function (req, res){
  let userRole = req.session.userRole || 'guest';
  res.render("enrolment", { userRole: userRole });
  });

  app.get('/news&events', function (req, res){
    let userRole = req.session.userRole || 'guest';
    res.render("news&events", { userRole: userRole });
    });

    app.get('/contactUs', function (req, res){
      let userRole = req.session.userRole || 'guest';
      res.render("contactUs", { message: null, userRole: userRole });
  });


app.get('/register', function(req, res) {
  let userRole = req.session.userRole || 'guest';
  res.render('register', { message: null, userRole: userRole });  // Pass userRole to the view
});
    
  app.post('/registerUser', function(req, res) {
    let FirstName = req.body.firstName;
    let LastName = req.body.lastName;
    let Gender = req.body.gender;
    let Role = req.body.role;
    let Email = req.body.email;
    let ConfirmEmail = req.body.confirmEmail;
    let Password = req.body.password;
    let ConfirmPassword = req.body.confirmPassword;

    if (FirstName && LastName && Gender && Role && Email === ConfirmEmail && Password === ConfirmPassword) {
        var sql = `INSERT INTO users (First_Name, Last_Name, Gender, Role, Email, Password) VALUES ("${FirstName}", "${LastName}", "${Gender}", "${Role}", "${Email}", "${Password}")`;
        conn.query(sql, function(err, result) {
            if (err) throw err;
            console.log('Record inserted');
            let message = 'Registration successful!';
            let userRole = req.session.userRole || 'guest';
            res.render('register', { message: message , userRole: userRole});  // Pass success message
        });
    } else {
        console.log("Error");
        let message = "Registration failed. Please check your input.";  // Failure message
        let userRole = req.session.userRole || 'guest';
        res.render('register', { message: message , userRole: userRole});
    }
});



app.get('/login', function (req, res){
  let userRole = req.session.userRole || 'guest';
  res.render("login.ejs",{ userRole: userRole});
  });

  app.post('/auth', function(req, res) {
    let Email = req.body.email;
    let Password = req.body.password;
    
    if (Email && Password) {
      conn.query('SELECT * FROM users WHERE Email = ? AND Password = ?', [Email, Password], function(error, results, fields) {
        if (error) throw error;
        console.log(results.length);
        if (results.length > 0) {
          req.session.loggedin = true;			
          req.session.email = Email;
          req.session.userRole = results[0].Role;
          console.log(results.length);
          console.log("Email :",results[0].Email);
          console.log("User Role :",results[0].Role)			
          res.redirect('/membersOnly');
        } else {
          res.send('Incorrect Username and/or Password!');
        }			
        res.end();
      });
    } else {
      res.send('Please enter Username and Password!');
      res.end();
    }
  });

  // Users can access this if they are logged in
  app.get('/membersOnly', function (req, res, next) {
    if (req.session.loggedin) {
      if (req.session.userRole === "admin") {
        res.render('adminOnly', { userRole: req.session.userRole });
      } 
      else if (req.session.userRole === "teacher") {
        res.render('teacherProfile', { userRole: req.session.userRole });
      } 
      else if (req.session.userRole === "parent") {
        res.render('parentProfile', { userRole: req.session.userRole });
      } 
    } else {
      res.send('Please login to view this page!');
    }
  });

  app.get('/teacherProfile', function (req, res){
    let userRole = req.session.userRole || 'guest'; // Default to 'guest' if not logged in
    res.render('teacherProfile', { userRole: userRole });
    });

    app.get('/parentProfile', function (req, res){
      let userRole = req.session.userRole || 'guest'; // Default to 'guest' if not logged in
      res.render('parentProfile', { userRole: userRole });
      });

      app.get('/logout',(req, res)=>{
        req.session.destroy();
        res.redirect('/');
        });

  app.get('/adminOnly', function (req, res){
  let userRole = req.session.userRole || 'guest'; // Default to 'guest' if not logged in
  res.render('adminOnly', { userRole: userRole });
    });

    app.post('/submitContactForm', function(req, res) {

      let userRole = req.session.userRole || 'guest';

      var FirstName = req.body.firstName;
      var Gender = req.body.gender;
      var Email = req.body.email;
      var Subject= req.body.subject;
      var Message=req.body.message;

      if (FirstName &&  Gender && Email && Subject && Message) {
        var sql = `INSERT INTO contactUs (First_Name, Gender, Email, Subject, Message) VALUES ("${FirstName}", "${Gender}", "${Email}","${Subject}", "${Message}")`;
        conn.query(sql, function(err, result) {
          if (err) throw err;
          console.log('record inserted');
          res.render('contactUs',  { userRole: userRole, message: 'Your contact form was successfully submitted. We reach you soon. Thank you for contacting us!'});
        })
      }
      else {
        console.log("Error");
      }
      });


      app.post('/submitFeedbackForm', function(req, res) {

        let userRole = req.session.userRole || 'guest';

        var FirstName = req.body.firstName;
        var LastName = req.body.lastName;
        var Gender = req.body.gender;
        var Email = req.body.email;
        var ConfirmEmail = req.body.confirmEmail;
        var Feed =req.body.feed;

        if (FirstName && LastName && Gender && Email && ConfirmEmail && Feed && Email === ConfirmEmail) {
          var sql = `INSERT INTO feedBack (First_Name, Last_Name, Gender, Email, Feed) VALUES ("${FirstName}", "${LastName}", "${Gender}","${Email}", "${Feed}")`;
          conn.query(sql, function(err, result) {
            if (err) throw err;
            console.log('record inserted');
            res.render('contactUs',  { userRole: userRole, message: 'Your feedback form successfully submited. Thank you!'});
          })
        }
        else {
          console.log("Error");
        }
        });


app.listen(3000);
console.log('Node app is running on port 3000');