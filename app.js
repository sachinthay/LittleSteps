var express = require('express');
var app = express();
var session = require('express-session');
var conn = require('./dbConfig');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');

const saltRounds = 10; 

const multer = require('multer');
const path = require('path');



app.set('view engine','ejs');



app.use(bodyParser.urlencoded({ extended: true }));

app.use(session({
  secret: 'mySecret',    // Secret to sign the session ID
  resave: false,         // Session is only saved if modified
  saveUninitialized: true // Unmodified sessions are stored in the session store
}));

const hasPartnerMiddleware = require('./middleware'); 
app.use(hasPartnerMiddleware); // This applies the middleware to all routes

// Middleware to parse incoming form data
app.use(express.urlencoded({ extended: true }));  // Parses URL-encoded bodies (form data)
app.use(express.json());  // Parses JSON bodies

app.use('/public', express.static('public')); // use public folder

// Set up Multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'public/uploads');  // Directory to store uploaded images
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname)); // Ensure unique file names
  }
});

const upload = multer({ storage: storage });


// Middleware to check user role
function checkUserRole(req, res, next) {
  // If user is logged in, use their role from the session
  if (req.session && req.session.userRole) {
      req.userRole = req.session.userRole;
  } else {
      // If no user is logged in, default to 'guest'
      req.userRole = 'guest';
  }
  next(); // Proceed to the next middleware or route handler
}

app.use((req, res, next) => {
  res.locals.currentPath = req.path; // Pass current path to all templates
  next();
});
// Apply the middleware globally (for all routes)
app.use(checkUserRole);

function getTitleAndName(firstName, lastName, gender) {
  let title = '';
  // Determine title based on gender
  if (gender === 'male') {
    title = 'Mr.';
  } else if (gender === 'female') {
    title = 'Ms.';
  } else {
    title = '';  // Default if gender is not provided
  }
 
  const first = firstName ;
  const last = lastName ;

  const name = `${first} ${last}`;

  return `${title} ${name}`;
  
}

app.use((req, res, next) => {
  if (req.session.loggedin) {
    // User is logged in, set userTitleAndName and userRole
    const titleAndName = getTitleAndName(req.session.firstName, req.session.lastName, req.session.gender);
    // Store values in res.locals so they are accessible in all views
    res.locals.userTitleAndName = titleAndName;
    res.locals.userRole = req.session.userRole;
  } else {
    // Default for guests
    res.locals.userTitleAndName = '';
    res.locals.userRole = 'guest';
  }
  next();  // Continue to the next middleware or route handler
});

app.use((req, res, next) => {
  if (req.session.loggedin && req.userRole === 'admin') {
    const countPendingSql = "SELECT COUNT(*) AS pendingCount FROM users WHERE Status = 'pending'";
    conn.query(countPendingSql, function (err, result) {
      if (err) {
        console.error("Error fetching pending count:", err);
        res.locals.pendingCount = 0;
      } else {
        res.locals.pendingCount = result[0].pendingCount || 0;
      }
      next();
    });
  } else {
    res.locals.pendingCount = 0;
    next();
  }
});

app.get('/', (req, res) => {
  let query1 = "SELECT * FROM pages WHERE Name = 'home'";
  let query2 = "SELECT * FROM slideshow";

  conn.query(query1, (err, contentResult) => {
    if (err) throw err;

    conn.query(query2, (err, slideshowResult) => {
      if (err) throw err;

        res.render('home', {
          homepageContent: contentResult,
          slideshow: slideshowResult
        });
      });
    });
  });



app.get('/aboutUs', (req, res) => {
  let query = "SELECT * FROM pages";

  conn.query(query, (err, contentResult) => {
    if (err) throw err;

      res.render('aboutUs', {
        pageContent: contentResult
      });

    });

  });

app.get('/enrolment', function(req, res) {
  
  conn.query('SELECT * FROM EnrollmentDetails', (err, detailResults) => {
    if (err) {
      console.error("Error fetching enrollment details:", err);
      return res.status(500).send("Error fetching enrollment details");
    }

  conn.query('SELECT * FROM EnrollmentFees ORDER BY day_count', (err, results) => {
    if (err) {
      console.error(err);
      return res.status(500).send("Error fetching enrolment fees");
    }
    res.render('enrolment', { feesData: results , enrollmentDetails: detailResults.map(row => row.detail)});
  });
});
});

app.get('/admin/enrolment', (req, res) => {
  if (req.session.loggedin && req.userRole === 'admin') {
  conn.query('SELECT * FROM EnrollmentDetails', (err, detailResults) => {
    if (err) {
      console.error("Error fetching enrollment details:", err);
      return res.status(500).send("Error fetching enrollment details");
    }

    conn.query('SELECT * FROM EnrollmentFees ORDER BY day_count', (err, feeResults) => {
      if (err) {
        console.error("Error fetching enrolment fees:", err);
        return res.status(500).send("Error fetching enrolment fees");
      }

      res.render('adminEnrolment', {
        feesData: feeResults,
        enrollmentDetails: detailResults.map(row => row.detail) // Extract details as an array
      });
    });
  });
} else if (!req.session.loggedin) {
  res.redirect('/login');  
} else {
  res.send('Access denied: Admin only');
}

});



app.post('/updateFees', (req, res) => {
  if (req.session.loggedin && req.userRole === 'admin') {
  const updatedFees = [];

  Object.keys(req.body).forEach(key => {
    const [field, id] = key.split('__'); // Split by the new delimiter `__`

    let fee = updatedFees.find(f => f.id === id);

    if (!fee) {
      fee = { id }; // Initialize a new fee object for this ID
      updatedFees.push(fee);
    }

    // Assign the field value to the fee object
    fee[field] = req.body[key];
  });

  //console.log("Parsed Updated Fees:", updatedFees);

  // Update each fee in the database
  updatedFees.forEach(fee => {
    const updateQuery = `
      UPDATE EnrollmentFees 
      SET short_day_fee_under_3 = ?, 
          long_day_fee_under_3 = ?, 
          short_day_fee_over_3 = ?, 
          long_day_fee_over_3 = ? 
      WHERE id = ?`;

    conn.query(updateQuery, [
      fee.short_day_fee_under_3 || null, // Provide fallback for undefined fields
      fee.long_day_fee_under_3 || null,
      fee.short_day_fee_over_3 || null,
      fee.long_day_fee_over_3 || null,
      fee.id
    ], (err, result) => {
      if (err) {
        console.error("Error updating fee with ID:", fee.id, err);
      }
    });
  });

  res.redirect('/admin/enrolment');
} else if (!req.session.loggedin) {
  res.redirect('/login');  
} else {
  res.send('Access denied: Admin only');
}
});




app.post('/updateEnrollmentDetails', (req, res) => {
  if (req.session.loggedin && req.userRole === 'admin') {
  const updatedDetails = Object.keys(req.body).map(key => req.body[key]);

  conn.query('DELETE FROM EnrollmentDetails', (err) => {
    if (err) {
      console.error("Error clearing details:", err);
      return res.status(500).send("Error updating details");
    }

    const insertQuery = 'INSERT INTO EnrollmentDetails (detail) VALUES ?';
    const values = updatedDetails.map(detail => [detail]);

    conn.query(insertQuery, [values], (err) => {
      if (err) {
        console.error("Error saving details:", err);
        return res.status(500).send("Error saving details");
      }

      res.redirect('/admin/enrolment');
    });
  });
} else if (!req.session.loggedin) {
  res.redirect('/login');  
} else {
  res.send('Access denied: Admin only');
}
});


app.get('/contactUs', (req, res) => {
  const sql = 'SELECT * FROM contact_info WHERE id = 1'; // Assuming there's only one record
  conn.query(sql, (err, result) => {
      if (err) {
          console.error('Error fetching contact info:', err);
          res.status(500).send('Error retrieving data.');
      } else {
          res.render('contactUs', { contact: result[0], message: null }); // Render EJS view with data
      }
  });
});

// Register route
app.get('/register', function(req, res) {
  res.render('register', { message: null});
});
    

app.post('/registerUser', async function (req, res) {
  let FirstName = req.body.firstName;
  let LastName = req.body.lastName;
  let Gender = req.body.gender;
  let Role = req.body.role;
  let Email = req.body.email;
  let ConfirmEmail = req.body.confirmEmail;
  let Password = req.body.password;
  let ConfirmPassword = req.body.confirmPassword;

  let status = 'pending'; // Default status to pending for new registrations

  // Ensure all required fields are filled and emails/passwords match
  if (FirstName && LastName && Gender && Role && Email === ConfirmEmail && Password === ConfirmPassword) {
    try {
      // Check if the email already exists in the database
      let emailCheckQuery = `SELECT * FROM users WHERE Email = ?`;

      conn.query(emailCheckQuery, [Email], async function (err, result) {
        if (err) throw err;

        // If the email already exists
        if (result.length > 0) {
          let existingUser = result[0]; // Get the existing user data
          let message;
          if (existingUser.Status === 'pending') {
            message = 'This email is already registered and awaiting admin approval.';
          } else if (existingUser.Status === 'approved') {
            message = 'This email is already registered and admin approved. Now you can log in.';
          } else {
            message = 'This email is already registered.';
          }
          return res.render('register', { message: message });
        }

        // If email does not exist, hash the password
        const saltRounds = 10; // Adjust salt rounds for desired security
        const hashedPassword = await bcrypt.hash(Password, saltRounds);

        // Insert the new user with the hashed password
        let sql = `INSERT INTO users (First_Name, Last_Name, Gender, Role, Email, Password, Status) 
                   VALUES (?, ?, ?, ?, ?, ?, ?)`;

        conn.query(sql, [FirstName, LastName, Gender, Role, Email, hashedPassword, status], function (err, result) {
          if (err) throw err;

          let message = 'Registration successful! Your account is awaiting admin approval.';
          res.render('register', { message: message });
        });
      });
    } catch (error) {
      console.error('Error during registration:', error);
      let message = 'An error occurred during registration. Please try again later.';
      res.render('register', { message: message });
    }
  } else {
    let message = "Registration failed. Please check your input."; // Failure message for mismatched fields
    res.render('register', { message: message });
  }
});


app.get('/login', function (req, res) {
  // Now using req.userRole set by the middleware
  res.render("login", { userRole: req.userRole });
});

app.post('/login', function (req, res) {
  const { email, password } = req.body;

  if (email) {
    conn.query('SELECT * FROM users WHERE Email = ?', [email], async function (error, results) {
      if (error) throw error;

      if (results.length > 0) {
        let user = results[0]; // Get the first user record

        if (user.Password === '' || user.Password === null) {
          req.session.user = user; // Store user info in session
          return res.redirect(`/setPassword/${user.Email}`);
        }

        // Compare the entered password with the hashed password
        const match = await bcrypt.compare(password, user.Password);

        if (match) {
          if (user.Status === 'approved') {
            req.session.loggedin = true;
            req.session.email = user.Email; 
            req.session.userRole = user.Role;
            req.session.firstName = user.First_Name;
            req.session.lastName = user.Last_Name;
            req.session.gender = user.Gender;
            return res.redirect('/membersOnly');
          } else {
            res.render('login', { message: 'Your account is pending approval by an admin.' });
          }
        } else {
          res.render('login', { message: 'Invalid Password. Please enter correct Password.' });
        }
      } else {
        res.render('login', { message: 'No user found with this email.' });
      }
    });
  } else {
    res.render('login', { message: 'Please enter both email and password.' });
  }
});


app.get('/setPassword/:email', function (req, res) {
  const email = req.params.email;

  // Render the set password form
  res.render('setPassword', { email: email, message: null });
});



app.post('/setPassword/:email', async function (req, res) {
  const email = req.params.email;
  const { password, confirm_password } = req.body;

  // Ensure both passwords match
  if (password && confirm_password && password === confirm_password) {
    try {
      // Hash the password using bcrypt
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // Update the hashed password in the database where Password is NULL
      conn.query(
        'UPDATE users SET Password = ? WHERE Email = ? AND Password IS NULL',
        [hashedPassword, email],
        function (error, results) {
          if (error) {
            console.error('Error updating password:', error);
            return res.render('setPassword', {
              email: email,
              message: 'Error updating password.',
            });
          }

          // Check if any rows were updated
          if (results.affectedRows === 0) {
            res.render('setPassword', {
              email: email,
              message: 'Password cannot be updated. Either the email does not exist, or a password has already been set.',
            });
          } else {
            // Password successfully updated, redirect to login
            res.render('login', { message: 'Password successfully updated. Please log in.' });
          }
        }
      );
    } catch (err) {
      console.error('Error hashing password:', err);
      res.render('setPassword', { email: email, message: 'Error processing password. Please try again.' });
    }
  } else {
    res.render('setPassword', { email: email, message: 'Passwords do not match. Please try again.' });
  }
});




app.get('/membersOnly', function (req, res) {
  if (req.session.loggedin) {
    // Get the title and initials using the helper function
    const titleAndName = getTitleAndName(req.session.firstName, req.session.lastName, req.session.gender);
    const email = req.session.email;  

    switch (req.userRole) {
      case 'admin':
        res.render('adminOnly', { userTitleAndName: titleAndName });
        break;
      case 'teacher':
        res.render('teachersOnly', { userTitleAndName: titleAndName });
        break;
      case 'parent':
        // Here you can check if the parent has a partner (use your hasPartnerMiddleware if needed)
        // For now, I'll just render the parent's page with the title and name.
        res.render('parentsOnly', {
          userTitleAndName: titleAndName
        });
        break;
      default:
        res.send('Access denied.');
    }
  } else {
    res.send('Please login to view this page!');
  }
});



// GET teachersOnly - accessible to teachers only
app.get('/teachersOnly', function (req, res) {
  if (req.session.loggedin && req.userRole === 'teacher') {
    // Pass the user role along with the title and name
    const titleAndName = getTitleAndName(req.session.firstName, req.session.lastName, req.session.gender);
    res.render('teachersOnly', { userRole: req.userRole, userTitleAndName: titleAndName });
  } else if (!req.session.loggedin) {
    res.redirect('/login');  // Redirect to login if the user is not logged in
  } else {
    res.send('Access denied: Teachers only');
  }
});

app.get('/parentsOnly', function (req, res) {
  if (req.session.loggedin && req.userRole === 'parent') {
    // Get the title and name based on the user's session data
    const titleAndName = getTitleAndName(req.session.firstName, req.session.lastName, req.session.gender);

    // Render the parentsOnly view, passing hasPartner (from res.locals) and title and name
    res.render('parentsOnly', { 
      hasPartner: res.locals.hasPartner, // Use the hasPartner from the middleware
      userTitleAndName: titleAndName
    });
  } else if (!req.session.loggedin) {
    // If the user is not logged in, redirect to the login page
    res.redirect('/login');
  } else {
    // Access denied if the user is not a parent
    res.send('Access denied: Parent only');
  }
});



app.get('/adminOnly', (req, res) => {
  if (req.session.loggedin && req.userRole === 'admin') {
    res.render('adminOnly', { title: 'Admin Portal' });
  } else if (!req.session.loggedin) {
    res.redirect('/login');  // Redirect to login if the user is not logged in
  } else {
    res.send('Access denied: Admin only');
  }

});



app.post('/submitContactForm', (req, res) => {
  const { firstName, gender, email, subject, message } = req.body;

  console.log("Contact Form Submission:", req.body); // Debugging

  if (firstName && gender && email && subject && message) {
      const sql = `INSERT INTO contactUs (First_Name, Gender, Email, Subject, Message) VALUES (?, ?, ?, ?, ?)`;
      conn.query(sql, [firstName, gender, email, subject, message], (err, result) => {
          if (err) {
              console.error("Database Error:", err);
              return res.status(500).send('Error submitting the contact form.');
          }
          console.log("Form submitted successfully:", result);
          res.render('contactUs', { message: 'Your contact form was successfully submitted. We will reach out soon.' });
      });
  } else {
      console.error("Missing fields in contact form");
      res.render('contactUs', { message: 'Please fill in all the required fields.' });
  }
});

app.get('/admin/contactUs', (req, res) => {
  if (req.session.loggedin && req.userRole === 'admin') {
  const query = 'SELECT * FROM contactUs ORDER BY created_at DESC';
  conn.query(query, (err, results) => {
      if (err) {
          console.error("Error fetching 'Contact Us' data:", err);
          return res.status(500).send('Error fetching contact data.');
      }
      res.render('adminContactUs', { data: results });
  });
} else if (!req.session.loggedin) {
  res.redirect('/login');  // Redirect to login if the user is not logged in
} else {
  res.send('Access denied: Admin only');  // Access denied message for non-admin users
}
});

app.get('/manageContactUs', (req, res) => {
  if (req.session.loggedin && req.userRole === 'admin') {
  const query = 'SELECT * FROM contact_info LIMIT 1'; // Modify this query based on your database structure
  conn.query(query, (err, results) => {
    if (err) {
      return res.status(500).send('Error fetching contact info');
    }

    const contact = results[0]; // Assuming you have a single contact entry
    res.render('manageContactUs', { contact, message:'' });

  });
} else if (!req.session.loggedin) {
  res.redirect('/login');  // Redirect to login if the user is not logged in
} else {
  res.send('Access denied: Admin only');
}

});
//manage contactus page
app.post('/updateContactInfo', (req, res) => {
  if (req.session.loggedin && req.userRole === 'admin') {
  const { address, phone, email, location_link } = req.body;

  // Update query
  const sql = `UPDATE contact_info SET address = ?, phone = ?, email = ?, location_link = ? WHERE id = 1`;

  conn.query(sql, [address, phone, email, location_link], (err, result) => {
      if (err) {
          console.error('Error updating contact info:', err);
          res.status(500).send('Failed to update contact info.');
      } else {
          res.redirect('/manageContactUs'); // Redirect to the /contactUs route
      }
  });
} else if (!req.session.loggedin) {
  res.redirect('/login');  // Redirect to login if the user is not logged in
} else {
  res.send('Access denied: Admin only');
}
});



// POST submitFeedbackForm - Handles feedback form submission
app.post('/submitFeedbackForm', function(req, res) {

  var FirstName = req.body.firstName;
  var LastName = req.body.lastName;
  var Gender = req.body.gender;
  var Email = req.body.email;
  var ConfirmEmail = req.body.confirmEmail;
  var Feed = req.body.feed;

  if (FirstName && LastName && Gender && Email && ConfirmEmail && Feed && Email === ConfirmEmail) {
    var sql = `INSERT INTO feedBack (First_Name, Last_Name, Gender, Email, Feed) VALUES (?, ?, ?, ?, ?)`;
    conn.query(sql, [FirstName, LastName, Gender, Email, Feed], function(err, result) {
      if (err) throw err;
      //console.log('Feedback form submitted successfully');
      res.render('contactUs', { message: 'Your feedback was successfully submitted. Thank you!' });
    });
  } else {
    //console.log("Error: Missing or mismatched form data");
    res.render('contactUs', { message: 'Please fill in all the required fields, and make sure emails match.' });
  }
});

app.get('/admin/feedback', (req, res) => {
  if (req.session.loggedin && req.userRole === 'admin') {
  const query = 'SELECT * FROM feedBack ORDER BY created_at DESC';
  conn.query(query, (err, results) => {
      if (err) {
          console.error("Error fetching feedback data:", err);
          return res.status(500).send('Error fetching feedback data.');
      }
      res.render('adminFeedback', { data: results });
  });
} else if (!req.session.loggedin) {
  res.redirect('/login');  // Redirect to login if the user is not logged in
} else {
  res.send('Access denied: Admin only');  // Access denied message for non-admin users
}
});

app.get('/manageUser', function (req, res) {
  if (req.session.loggedin && req.userRole === 'admin') {
    const selectedRole = req.query.role || '';
    const message = req.query.message; // Retrieve any message passed in the query

    // Query to fetch users
    const fetchUsersSql = "SELECT * FROM users ORDER BY created_at DESC";

    conn.query(fetchUsersSql, function (err, result) {
      if (err) {
        console.error("Error fetching users:", err);
        return res.status(500).send("Internal Server Error");
      }
      // Render the manageUser page with data and the pending count from res.locals
      res.render('manageUser', {
        title: 'Manage User',
        manageUserData: result,
        message: message, // Pass the message to the view
        selectedRole,
        selectedStatus: '',
        pendingCount: res.locals.pendingCount, // Use the pending count from middleware
      });
    });
  } else if (!req.session.loggedin) {
    res.redirect('/login'); // Redirect to login if the user is not logged in
  } else {
    res.send('Access denied: Admin only'); // Access denied message for non-admin users
  }
});

//Manage user fillter by
app.get('/registerApproval', (req, res) => {
  if (req.session.loggedin && req.userRole === 'admin') {
  const selectedRole = req.query.role || '';    // Get role filter from query
  const selectedStatus = req.query.status || ''; // Get status filter from query

  let sql = 'SELECT * FROM users WHERE 1=1'; // Start with a default condition
  const params = [];
  // Add role filter if selected
  if (selectedRole) {
    sql += ' AND Role = ?';
    params.push(selectedRole);
  }
  // Add status filter if selected
  if (selectedStatus) {
    sql += ' AND Status = ?';
    params.push(selectedStatus);
  }

  conn.query(sql, params, (err, results) => {
    if (err) {
      return res.status(500).send('Error fetching users: ' + err);
    }

    res.render('manageUser', {
      title: 'Manage User',
      manageUserData: results,
      selectedRole, // Pass the selected role to the template
      selectedStatus, // Pass the selected status to the template
      message: ''
    });
  });
} else if (!req.session.loggedin) {
  res.redirect('/login');  // Redirect to login if the user is not logged in
} else {
  res.send('Access denied: Admin only');
}
});

      // POST approveUser - Admin can approve or change user status
app.post('/approveUser', function(req, res) {
  if (req.session.loggedin && req.userRole === 'admin') {
    let Email = req.body.email;
    let Status = req.body.status;
    let sql = `UPDATE users SET Status = ? WHERE Email = ?`;

    // Update user status in the database
    conn.query(sql, [Status, Email], function(err, result) {
      if (err) throw err;

      // After updating, fetch the updated user list
      const fetchUsersSql = 'SELECT * FROM users';
      conn.query(fetchUsersSql, function(err, users) {
        if (err) throw err;

        // Render the manageUser view with updated data
        res.render('manageUser', { 
          title: 'Manage User',
          manageUserData: users,
          message: 'User Status updated Successfully.',
          userRole: req.userRole,
          selectedRole: '',// Use userRole from middleware
          selectedStatus:''
        });
      });
    });
  } else if (!req.session.loggedin) {
    res.redirect('/login');  // Redirect to login if the user is not logged in
  } else {
    res.send('Access denied: Admin only');
  }
});

// POST deleteUser - Admin can delete a user
app.post('/deleteUser', function(req, res) {
  if (req.session.loggedin && req.userRole === 'admin') {
    const Email = req.body.email;  // Retrieve the email from the form data
    const deleteSql = 'DELETE FROM users WHERE Email = ?';

    // Delete the user from the database
    conn.query(deleteSql, [Email], (err, result) => {
      if (err) {
        return res.status(500).send('Error deleting user: ' + err);
      }

      // After deletion, fetch the updated user list
      const fetchUsersSql = 'SELECT * FROM users ORDER BY created_at DESC';
      conn.query(fetchUsersSql, (err, users) => {
        if (err) {
          return res.status(500).send('Error fetching users: ' + err);
        }

        // Render the manageUser view with the updated list
        res.render('manageUser', {
          title: 'Manage User',
          manageUserData: users,
          userRole: req.userRole,  // Use userRole from middleware
          message: 'User deleted successfully!',
          selectedRole: '',
          selectedStatus:''
        });
      });
    });
  } else if (!req.session.loggedin) {
    res.redirect('/login');  // Redirect to login if the user is not logged in
  } else {
    res.send('Access denied: Admin only');
  }
});

// GET ourStaff - View the staff list sorted by position
app.get('/ourStaff', function(req, res) {
  // Query to join teachers and users based on Email
  conn.query("SELECT * FROM teachers as t INNER JOIN users as u ON t.Email = u.Email", function(err, result) {
    if (err) throw err;

    // Define position priority for sorting
    const positionPriority = {
      'Center Manager': 1,
      'Qualified Teacher': 2,
      'Unqualified Teacher': 3,
      'Trainee Teacher': 4,
      'Caregiver': 5,
      'Reliever': 6,
    };

    // Sort the result based on position priority
    result.sort((a, b) => {
      return positionPriority[a.Position] - positionPriority[b.Position];
    });

    // Render the ourStaff view and pass the user role and sorted data
    res.render('ourStaff', { 
      title: 'Our Staff',
      manageStaffData: result,
      userRole: req.userRole || 'guest'  // Use userRole from middleware or default to guest
    });
  });
});
  // Route to display the update profile page for teachers
app.get('/teacherProfile', function(req, res) {
  if (req.session.loggedin && req.userRole === 'teacher') {
    const message = req.query.message;  // Retrieve the message from the query string, if any
    const email = req.session.email;
    // Query to get the teacher's profile
    conn.query("SELECT * FROM teachers AS t INNER JOIN users AS u ON t.Email = u.Email WHERE t.Email = ?", [email], function(err, result) {
     // console.log("Query result1:", result);
      
      if (err) {
        console.error("Error fetching profile:", err); 
        return res.render('teacherProfile', { 
          userRole: req.userRole,  // Use userRole from middleware
          message: 'Error fetching profile data',
          data: result,
          editMode: false,  // No data to show in case of an error
        });
      }
      
      // Check if the result is empty
      if (result.length === 0) {
        // If no profile data found, fetch basic user data from the users table
        conn.query("SELECT First_Name, Last_Name, Email FROM users WHERE Email = ?", [email], function(err, userResult) {
          if (err) {
            console.error("Error fetching user data:", err); 
            return res.render('teacherProfile', { 
              userRole: req.userRole,  // Use userRole from middleware
              message: 'Error fetching user data',
              data: userResult,
              editMode: false, 
            });
          }
          
          // If user data is found, render with that data
          if (userResult.length > 0) {
            res.render('teacherProfile', { 
              title: 'Update Teacher Profile',
              data: {  // Create a data object that includes user data
                First_Name: userResult[0].First_Name,
                Last_Name: userResult[0].Last_Name,
                Email: userResult[0].Email,
                Position: '',  // Default or placeholder if not applicable
                Qualification: '',  // Default or placeholder if not applicable
                Note: '',  // Default or placeholder if not applicable
                Picture: ''  // Default or placeholder if not applicable
              },
              message: message,
              userRole: req.userRole,  // Use userRole from middleware
              email: email,
              editMode: false, 
            });
          } else {
            // If no user data is found, handle accordingly
            res.render('teacherProfile', { 
              title: 'Update Teacher Profile',
              data: null,
              message: 'User not found',
              userRole: req.userRole,  // Use userRole from middleware
              email: email,
              editMode: false, 
            });
          }
        });
      } else {
        // Render the profile with the fetched teacher data
        res.render('teacherProfile', { 
          title: 'Update Teacher Profile',
          data: result[0],
          message: message,
          userRole: req.userRole,  // Use userRole from middleware
          email: email,
          editMode: false, 
        });
      }
    });
  } else if (!req.session.loggedin) {
    res.redirect('/login');  // Redirect to login if not logged in
  } else {
    res.send('Access denied: Teachers only');  // If user is not a teacher
  }
});

// Route to edit the teacher's profile
app.get('/editTeacher', function(req, res) {
  if (req.session.loggedin && req.userRole === 'teacher') {
    const message = req.query.message;  // Retrieve the message from the query string, if any
    const email = req.session.email;

    // Log session email for debugging
    //console.log("Session email in editProfile:", email);
    
    // Query to get the teacher's profile
    conn.query("SELECT * FROM teachers AS t INNER JOIN users AS u ON t.Email = u.Email WHERE t.Email = ?", [email], function(err, result) {
    //  console.log("Query result2:", result);
      
      if (err) {
        console.error("Error fetching profile:", err); 
        return res.render('teacherProfile', { 
          userRole: req.userRole,  // Use userRole from middleware
          message: 'Error fetching profile data',
          data: null,
          editMode: true,  // No data to show in case of an error
        });
      }
      
      // Check if the result is empty
      if (result.length === 0) {
        // If no profile data found, fetch basic user data from the users table
        conn.query("SELECT First_Name, Last_Name, Email FROM users WHERE Email = ?", [email], function(err, userResult) {
          if (err) {
            console.error("Error fetching user data:", err); 
            return res.render('teacherProfile', { 
              userRole: req.userRole,  // Use userRole from middleware
              message: 'Error fetching user data',
              data: null,
              editMode: true, 
            });
          }
          
          // If user data is found, render with that data
          if (userResult.length > 0) {
            res.render('teacherProfile', { 
              title: 'Update Teacher Profile',
              data: {  // Create a data object that includes user data
                First_Name: userResult[0].First_Name,
                Last_Name: userResult[0].Last_Name,
                Email: userResult[0].Email,
                Position: '',  // Default or placeholder if not applicable
                Qualification: '',  // Default or placeholder if not applicable
                Note: '',  // Default or placeholder if not applicable
                Picture: ''  // Default or placeholder if not applicable
              },
              message: message,
              userRole: req.userRole,  // Use userRole from middleware
              email: email,
              editMode: true, 
            });
          } else {
            // If no user data is found, handle accordingly
            res.render('teacherProfile', { 
              title: 'Update Teacher Profile',
              data: null,
              message: 'User not found',
              userRole: req.userRole,  // Use userRole from middleware
              email: email,
              editMode: true, 
            });
          }
        });
      } else {
        // Render the profile with the fetched teacher data
        res.render('teacherProfile', { 
          title: 'Update Teacher Profile',
          data: result[0],
          message: message,
          userRole: req.userRole,  // Use userRole from middleware
          email: email,
          editMode: true, 
        });
      }
    });
  } else if (!req.session.loggedin) {
    res.redirect('/login');  // Redirect to login if not logged in
  } else {
    res.send('Access denied: Teachers only');  // If user is not a teacher
  }
});



// Route to display the update profile page for parents
app.get('/parentProfile', function(req, res) {
  if (req.session.loggedin && req.userRole === 'parent') {
    const message = req.query.message;  // Retrieve the message from the query string, if any
    const email = req.session.email;

    // Query to get the parent's profile
    conn.query("SELECT * FROM parent AS p INNER JOIN users AS u ON p.Email = u.Email WHERE p.Email = ?", [email], function(err, result) {
      
      
      if (err) {
        console.error("Error fetching profile:", err); 
        return res.render('parentProfile', { 
          //userRole: req.userRole,  // Use userRole from middleware
          message: 'Error fetching profile data',
          data: result,
          editMode: false,  // No data to show in case of an error
        });
      }
      
      // Check if the result is empty
      if (result.length === 0) {
        // If no profile data found, fetch basic user data from the users table
        conn.query("SELECT First_Name, Last_Name, Email FROM users WHERE Email = ?", [email], function(err, userResult) {
          if (err) {
            console.error("Error fetching user data:", err); 
            return res.render('parentProfile', { 
             // userRole: req.userRole,  // Use userRole from middleware
              message: 'Error fetching user data',
              data: userResult,
              editMode: false, 
            });
          }
          
          // If user data is found, render with that data
          if (userResult.length > 0) {
            res.render('parentProfile', { 
              title: 'Update Parent Profile',
              data: {  // Create a data object that includes user data
                First_Name: userResult[0].First_Name,
                Last_Name: userResult[0].Last_Name,
                Email: userResult[0].Email,
                Position: '',  // Default or placeholder if not applicable
                Qualification: '',  // Default or placeholder if not applicable
                Note: '',  // Default or placeholder if not applicable
                Picture: ''  // Default or placeholder if not applicable
              },
              message: message,
             // userRole: req.userRole,  // Use userRole from middleware
              email: email,
              editMode: false, 
            });
          } else {
            // If no user data is found, handle accordingly
            res.render('parentProfile', { 
              title: 'Update Parent Profile',
              data: null,
              message: 'User not found',
             // userRole: req.userRole,  // Use userRole from middleware
              email: email,
              editMode: false, 
            });
          }
        });
      } else {
        // Render the profile with the fetched parent data
        res.render('parentProfile', { 
          title: 'Update Parent Profile',
          data: result[0],
          message: message,
         // userRole: req.userRole,  // Use userRole from middleware
          email: email,
          editMode: false, 
        });
      }
    });
  } else if (!req.session.loggedin) {
    res.redirect('/login');  // Redirect to login if not logged in
  } else {
    res.send('Access denied: Parents only');  // If user is not a parent
  }
});


// Route to display the edit profile page for parents
app.get('/editParent', function(req, res) {
  if (req.session.loggedin && req.userRole === 'parent') {  // Use req.userRole from middleware
    const message = req.query.message;
    const email = req.session.email;
    
    // Query to get the parent's profile
    conn.query("SELECT * FROM parent AS p INNER JOIN users AS u ON p.Email = u.Email WHERE p.Email = ?", [email], function(err, result) {
      //console.log("Query result2:", result);
      
      if (err) {
        console.error("Error fetching profile:", err); 
        return res.render('parentProfile', { 
         // userRole: req.userRole,  // Use req.userRole
          message: 'Error fetching profile data',
          data: null,
          editMode: true,  // Enable edit mode in case of an error
        });
      }
      
      // Check if the result is empty
      if (result.length === 0) {
        // Fetch basic user data if no profile data is found
        conn.query("SELECT First_Name, Last_Name, Email FROM users WHERE Email = ?", [email], function(err, userResult) {
          if (err) {
            console.error("Error fetching user data:", err); 
            return res.render('parentProfile', { 
             // userRole: req.userRole,  // Use req.userRole
              message: 'Error fetching user data',
              data: null,
              editMode: true, 
            });
          }
          
          // Render the profile with basic user data
          if (userResult.length > 0) {
            res.render('parentProfile', { 
              title: 'Update Parent Profile',
              data: {
                First_Name: userResult[0].First_Name,
                Last_Name: userResult[0].Last_Name,
                Email: userResult[0].Email,
                Relationship: '',  // Default or placeholder
                Occupation: '',  // Default or placeholder
                Mobile: '',  // Default or placeholder
                Address: '',  // Default or placeholder
                Picture: ''  // Default or placeholder
              },
              message: message,
             // userRole: req.userRole,  // Use req.userRole
              email: email,
              editMode: true, 
            });
          } else {
            res.render('parentProfile', { 
              title: 'Update Parent Profile',
              data: null,
              message: 'User not found',
             // userRole: req.userRole,  // Use req.userRole
              email: email,
              editMode: true, 
            });
          }
        });
      } else {
        // Render the profile with parent data
        res.render('parentProfile', { 
          title: 'Update Parent Profile',
          data: result[0],
          message: message,
         // userRole: req.userRole,  // Use req.userRole
          email: email,
          editMode: true, 
        });
      }
    });
  } else if (!req.session.loggedin) {
    res.redirect('/login');  // Redirect to login if not logged in
  } else {
    res.send('Access denied: Parent only');
  }
});
app.post('/updateParentProfile', upload.single('picture'), function (req, res) {
  if (req.session.loggedin && req.userRole === 'parent') {  // Use req.userRole

    const email = req.session.email;
    const { first_name, last_name, relationship, occupation, mobile, address } = req.body;
    let picture = req.body.oldPicture;  // Default to old picture if no new one is uploaded

    // Update picture if a new one is uploaded
    if (req.file) {
      picture = req.file.filename;
    }

    // Check for required fields
    if (first_name && last_name && relationship && occupation && mobile && address) {

      // Check if the parent exists in the 'parent' table
      conn.query('SELECT * FROM parent WHERE Email = ?', [email], (err, parentResult) => {
        if (err) {
          console.error('Error fetching parent data:', err);
          return res.render('parentProfile', { message: 'Error fetching parent data.', data: req.body });
        }

        if (parentResult.length > 0) {
          // Parent exists, proceed with the update
         // console.log("Parent exists, updating profile", email);

          // Update 'users' table
          conn.query('UPDATE users SET First_Name = ?, Last_Name = ? WHERE Email = ?',
            [first_name, last_name, email], (err, result) => {
              if (err) {
                console.error('Error updating user profile:', err);
                return res.render('parentProfile', { message: 'Error updating user profile.', data: req.body });
              }

              // Update 'parent' table
              conn.query('UPDATE parent SET Relationship = ?, Occupation = ?, Mobile = ?, Address = ?, Picture = ? WHERE Email = ?',
                [relationship, occupation, mobile, address, picture, email], (err, result) => {
                  if (err) {
                    console.error('Error updating parent profile:', err);
                    return res.render('parentProfile', { message: 'Error updating parent profile.', data: req.body });
                  }

                  // Successfully updated
                  res.redirect('/parentProfile?message=Profile updated successfully');
                });
            });

        } else {
          // No parent record exists, insert a new one
          //console.log("No parent record, inserting new profile", email);

          // Insert into 'parent' table
          conn.query('INSERT INTO parent (Email, Relationship, Occupation, Mobile, Address, Picture) VALUES (?, ?, ?, ?, ?, ?)',
            [email, relationship, occupation, mobile, address, picture], (err, insertResult) => {
              if (err) {
                console.error('Error inserting new parent profile:', err);
                return res.render('parentProfile', { message: 'Error inserting new parent profile.', data: req.body });
              }

              // Inserted successfully, now update the 'users' table
              conn.query('UPDATE users SET First_Name = ?, Last_Name = ? WHERE Email = ?',
                [first_name, last_name, email], (err, result) => {
                  if (err) {
                    console.error('Error updating user profile:', err);
                    return res.render('parentProfile', { message: 'Error updating user profile.', data: req.body });
                  }

                  // Successfully inserted and updated
                  res.redirect('/parentProfile?message=Profile created and updated successfully');
                });
            });
        }
      });

    } else {
      // Missing required fields
      res.redirect('/parentProfile?message=All fields are required');
    }
  } else if (!req.session.loggedin) {
    res.redirect('/login');  // Redirect to login if not logged in
  } else {
    res.send('Access denied: Parent only');
  }
});


// Route to handle the first-time insert of parent data
app.post('/insertParent', upload.single('picture'), function(req, res) {
  let email = req.session.email;
  let FirstName = req.body.first_name;
  let LastName = req.body.last_name;
  let picture = req.file ? req.file.filename : null;  // Uploaded picture or null
  let Relationship = req.body.relationship;
  let Occupation = req.body.occupation;
  let Mobile = req.body.mobile;
  let Address = req.body.address;

  // Validate required fields
  if (FirstName && LastName && Relationship && Occupation && Mobile && Address) {
      // Insert into the 'users' table
      let sql1 = "INSERT INTO users (First_Name, Last_Name, Email) VALUES (?, ?, ?)";
      conn.query(sql1, [FirstName, LastName, email], function(err, result) {
          if (err) {
              console.error("Error inserting into users:", err);
              return res.render('updateParentProfile', {  //userRole: req.userRole, 
                message: 'Error inserting user data', manageParentData: [], editMode: true });
          }

          // Insert into the 'parent' table
          let sql2 = "INSERT INTO parent (Email, Relationship, Occupation, Mobile, Address, Picture) VALUES (?, ?, ?, ?, ?, ?)";
          conn.query(sql2, [email, Relationship, Occupation, Mobile, Address, picture], function(err, result) {
              if (err) {
                  console.error("Error inserting into parent:", err);
                  return res.render('updateParentProfile', {  //userRole:req.userRole, 
                    message: 'Error inserting parent data', manageParentData: [], editMode: true });
              }

              // Successfully inserted, fetch the newly inserted data
              conn.query("SELECT * FROM parent AS p INNER JOIN users AS u ON p.Email = u.Email WHERE p.Email = ?", [email], function(err, updatedData) {
                  if (err) {
                      console.error("Error fetching new data:", err);
                      return res.render('updateParentProfile', {  //userRole: req.userRole, 
                        message: 'Error fetching profile data', manageParentData: [] });
                  }

                  res.render('updateParentProfile', {
                      manageParentData: updatedData,
                      editMode: false,  // Switch to view mode after successful insert
                      message: 'Profile created successfully!',
                      //userRole: req.userRole
                  });
              });
          });
      });
  } else {
      res.render('updateParentProfile', {  //userRole: req.userRole, 
        message: 'All fields are required!', manageParentData: [], editMode: true });
  }
});



app.get('/child', (req, res) => {
  if (req.session.loggedin && req.userRole === 'parent') {
    const email = req.session.email;

    // Fetch all children of this parent
    conn.query('SELECT * FROM child AS c INNER JOIN parent_child AS pc ON c.ID = pc.Child_ID WHERE pc.Parent_Email = ?', [email], (err, children) => {
      if (err) {
        console.error('Error fetching children:', err);
        return res.render('child', { message: 'Error fetching children data.', children: [] });
      }
      
      // Render the page with the list of children
      res.render('child', { children, message: req.query.message , //userRole: req.userRole,  
        editMode: false, });
    });
  } else if (!req.session.loggedin) {
    res.redirect('/login');  // Redirect to login if the user is not logged in
  } else {
    res.send('Access denied: Parent only');
  }
});
  


app.get('/editChild', function(req, res) {
  if (req.session.loggedin && req.userRole === 'parent') {
    const message = req.query.message;  // Retrieve the message from the query string, if any
    const email = req.session.email;

    // Log session email for debugging
  //  console.log("Session email in editProfile:", email);
    
    // Query to get the teacher's profile
    conn.query("SELECT * FROM child AS c INNER JOIN parent_child AS pc ON c.ID = pc.Child_ID WHERE pc.Parent_Email = ?", [email], function(err, result) {
      //console.log("Query result2:", result);
      
      if (err) {
        console.error("Error fetching profile:", err); 
        return res.render('child', { 
         // userRole: req.userRole, 
          message: 'Error fetching profile data',
          data: null,
          editMode:true,  // No data to show in case of an error
        });
      }
      if (result.length === 0) {
        res.render('child', { 
          title: 'Update child Profile',
          data: {  // Create a data object that includes user data
          First_Name:'' ,
          Last_Name: '',
            Gender:'' ,
            DOB: '', // Default or placeholder if not applicable
            Picture: '', // Default or placeholder if not applicable
            Food_Allergy: '' // Default or placeholder if not applicable
          },
          message: message,
         // userRole: req.userRole,
          email: email,
          editMode:true, 
        });
      }
      else{
        res.render('child', { 
          title: 'Update Child Profile',
          data: result[0],
          message: message,
         // userRole: req.userRole,
          email: email,
          editMode:true, 
        });
      }
      });
     } else if (!req.session.loggedin) {
    res.redirect('/login');  // Redirect to login if not logged in
  } else {
    res.send('Access denied: Parent only');  // If user is not a teacher
  }
});


app.post('/updateChild', upload.single('picture'), function (req, res) {
  if (req.session.loggedin && req.userRole === 'parent') {

    const email = req.session.email;
    const { first_name, last_name, gender, dob, food_allergy, child_id } = req.body;

    let picture = req.body.oldPicture; 
    

    // Update picture if a new one is uploaded
    if (req.file) {
      picture = req.file.filename;
    }

    // Check for required fields
    if (first_name && last_name && gender && dob && food_allergy) {

      // Check if the teacher exists in the 'teachers' table
      conn.query('SELECT * FROM child AS c INNER JOIN parent_child AS pc ON c.ID = pc.Child_ID WHERE pc.Parent_Email = ?', [email], (err, childResult) => {
        if (err) {
          console.error('Error fetching teacher data:', err);
          return res.render('child', { message: 'Error fetching child data.', data: req.body });
        }

        if (childResult.length > 0) {
          // Teacher exists, proceed with the update
          //console.log("Child exists, updating profile", email);

          // Update 'users' table
          conn.query('UPDATE child SET First_Name = ?, Last_Name = ?, Gender = ?, DOB = ?, Food_Allergy = ?, Picture = ? WHERE ID = ?',
            [first_name, last_name, gender, dob, food_allergy, picture, child_id], (err, result) => {
              if (err) {
                console.error('Error updating user profile:', err);
                return res.render('parentProfile', { message: 'Error updating user profile.', data: req.body });
              }

                res.redirect('/child?message=Profile updated successfully');
            });

        } else {
          // No teacher record exists, insert a new one
        //  console.log("No child record, inserting new profile", email);

          // Insert into 'teachers' table
          conn.query('INSERT INTO child (First_Name, Last_Name, Gender, DOB, Food_Allergy, Picture) VALUES (?, ?, ?, ?, ?, ?)',
            [first_name, last_name, gender, dob, food_allergy, picture], (err, insertResult) => {
              if (err) {
                console.error('Error inserting new child profile:', err);
                return res.render('child', { message: 'Error inserting new child profile.', data: req.body });
              }
              const newChildId = insertResult.insertId;
              // Inserted successfully, now update the 'users' table
              conn.query('INSERT INTO parent_child (Child_ID, Parent_Email ) VALUES (?, ?)',
                [ newChildId, email], (err, result) => {
                  if (err) {
                    console.error('Error updating user profile:', err);
                    return res.render('child', { message: 'Error updating child profile.', data: req.body });
                  }

                  // Successfully inserted and updated
                  res.redirect('/child?message=Profile created and updated successfully');
                });
            });
        }
      });

    } else {
      // Missing required fields
      res.redirect('/child?message=All fields are required');
    }
  } else if (!req.session.loggedin) {
    res.redirect('/login');  // Redirect to login if not logged in
  } else {
    res.send('Access denied: Parent only');  // If user is not a teacher
  }
});
    


app.post('/addChild', upload.single('picture'), function (req, res) {
  if (req.session.loggedin && req.userRole === 'parent') {

    const email = req.session.email;
    const { first_name, last_name, gender, dob, food_allergy } = req.body;

    let picture = req.file ? req.file.filename : null;

    if (first_name && last_name && gender && dob) {
      // Insert the new child into the 'child' table
      conn.query('INSERT INTO child (First_Name, Last_Name, Gender, DOB, Food_Allergy, Picture) VALUES (?, ?, ?, ?, ?, ?)', 
      [first_name, last_name, gender, dob, food_allergy, picture], (err, result) => {
        if (err) {
          console.error('Error inserting new child:', err);
          return res.redirect('/child?message=Error adding new child.');
        }

        const childID = result.insertId;

        // Associate the child with the parent in the 'parent_child' table
        conn.query('INSERT INTO parent_child (Child_ID, Parent_Email) VALUES (?, ?)', [childID, email], (err, result) => {
          if (err) {
            console.error('Error associating child with parent:', err);
            return res.redirect('/child?message=Error associating child with parent.');
          }

          res.redirect('/child?message=Child added successfully');
        });
      });
    } else {
      res.redirect('/child?message=All fields are required');
    }
  } else if (!req.session.loggedin) {
    res.redirect('/login');  // Redirect to login if the user is not logged in
  } else {
    res.send('Access denied: Parent only');
  }

});
  

app.get('/parentSendMsg', function(req, res) {
  if (req.session.loggedin && req.userRole === 'parent') {
    const email = req.session.email; // Logged-in parent's email
    const successMessage = req.query.message || "";  // Get the message from the query

    // First query to get children associated with the logged-in parent
    conn.query("SELECT * FROM child AS c INNER JOIN parent_child AS pc ON c.id = pc.child_id WHERE pc.parent_email = ?", [email], function(err, children) {
      if (err) {
        console.error("Error fetching children:", err);
        return res.status(500).send("Error fetching children");
      } else {
        // Second query to get teachers
        conn.query("SELECT * FROM teachers AS t INNER JOIN users AS u ON t.Email = u.Email WHERE t.Position='Qualified Teacher' ", function(err, teachers) {
          if (err) {
            console.error("Error fetching teachers:", err);
            return res.status(500).send("Error fetching teachers");
          } else {
            // Third query to get the message history for the parent
            conn.query(
              `SELECT u.First_Name AS Teacher_First_Name, 
                      u.Last_Name AS Teacher_Last_Name, 
                      c.First_Name AS Child_First_Name, 
                      c.Last_Name AS Child_Last_Name, 
                      m.Topic, 
                      m.Message,
                      m.Feedback,
                       m.ID
               FROM message m
               JOIN users u ON m.Receiver = u.Email
               JOIN child c ON m.Child = c.ID
               WHERE m.Sender = ?`, [email], function(err, manageMsgData) {
              if (err) {
                console.error("Error fetching message history:", err);
                return res.status(500).send("Error fetching message history");
              }

              // Render the form with children, teachers, and message history
              res.render('parentSendMsg', {
                children: children,
                teachers: teachers,
                manageMsgData: manageMsgData, // Pass the history to the view
                message: successMessage  // Pass the success message to the view
              });
            });
          }
        });
      }
    });
  } else if (!req.session.loggedin) {
    res.redirect('/login');  // Redirect to login if the user is not logged in
  } else {
    res.send('Access denied: Parent only');
  }
});


app.post('/parentSendMsg', function(req, res) {
  if (req.session.loggedin && req.userRole === 'parent') {
    const email = req.session.email; 
    const receiver = req.body.receiver;  
    const topic = req.body.topic;
    const message = req.body.message;
    const child = req.body.child;  
     

    // Insert the message into the `message` table
    conn.query('INSERT INTO message (Sender, Receiver, Topic, Child, Message) VALUES (?, ?, ?, ?,?)', [email, receiver, topic, child, message], function(err, result) {
      if (err) {
        console.error("Error inserting message:", err);
        return res.status(500).send("Error saving the message");
      }
      
      // Redirect to the GET route after successful insertion
      res.redirect('/parentSendMsg?message=Message sent successfully');
    });
  } else if (!req.session.loggedin) {
    res.redirect('/login');  // Redirect to login if the user is not logged in
  } else {
    res.send('Access denied: Parent only');
  }

});
   


app.get('/teacherInbox', function(req, res) {
  if (req.session.loggedin && req.userRole === 'teacher') {
    const message = req.query.message;
    const email = req.session.email; 

    // Query to get the parent (from users) and child names (from child table) along with the message data
    conn.query(
      `SELECT u.First_Name AS Parent_First_Name, 
              u.Last_Name AS Parent_Last_Name, 
              p.Relationship,
              c.First_Name AS Child_First_Name, 
              c.Last_Name AS Child_Last_Name, 
              m.*
       FROM message m
       JOIN users u ON m.Sender = u.Email
       JOIN child c ON m.Child = c.ID
       JOIN parent p ON m.Sender = p.Email
       WHERE m.Receiver = ?
       ORDER BY m.created_at DESC`, [email], 
      function(err, result) {
        if (err) throw err;
      
        res.render('teacherInbox', { 
          title: 'Manage User',
          manageMsgData: result,
          message: message,  
         // userRole: req.userRole
        });
      }
    );
  } else if (!req.session.loggedin) {
    res.redirect('/login');
  } else {
    res.send('Access denied: teachers only');
  }
});

app.get('/pages', (req, res) => {
  if (req.session.loggedin && req.userRole === 'admin') {
  const query = "SELECT * FROM pages";
  conn.query(query, (err, result) => {
    if (err) throw err;
    res.render('pages', { content: result,  
      //userRole: req.userRole 
    });
  });
} else if (!req.session.loggedin) {
  res.redirect('/login');
} else {
  res.send('Access denied: Admin only');
}
});

app.post('/pages/update', (req, res) => {
  if (req.session.loggedin && req.userRole === 'admin') {
    const { id, content } = req.body;
    let imageUrl = req.body.oldPicture; 
    

    // Update picture if a new one is uploaded
    if (req.file) {
      imageUrl = req.file.filename;
    }

    const query = "UPDATE pages SET Content = ?, Image_Url = ? WHERE ID = ?";

    conn.query(query, [content, imageUrl, id], (err, result) => {
      if (err) throw err;
      res.redirect('/pages'); // Redirects back to pages view
    });
  } else if (!req.session.loggedin) {
    res.redirect('/login');
  } else {
    res.send('Access denied: Admin only');
  }
});

app.get('/slideshow', (req, res) => {
  let slideshowQuery = "SELECT * FROM slideshow";

  conn.query(slideshowQuery, (err, slideshowResult) => {
    if (err) {
      console.error("Error executing query:", err);
      res.status(500).send("Server Error");
      return;
    }

    // Render the slideshow view with the fetched data
    res.render('slideshow', {
      slideshow: slideshowResult
    });
  });
});


app.post('/slideshow/update/:id', upload.single('image_url'), (req, res) => {
  if (req.session.loggedin && req.userRole === 'admin') {
    const { caption_title, caption_body } = req.body;
    const id = req.params.id;
    let imageUrl = req.body.oldPicture;  // Default to the old picture if no new one

    // Update image URL if a new file is uploaded
    if (req.file) {
      imageUrl = `/public/uploads/${req.file.filename}`;
    }

    const query = `
      UPDATE slideshow 
      SET Image_Url = ?, Caption_Title = ?, Caption_Body = ? 
      WHERE ID = ?
    `;

    conn.query(query, [imageUrl, caption_title, caption_body, id], (err, result) => {
      if (err) {
        console.error("Error updating slideshow item:", err);
        return res.redirect(`/editHome?message=Error updating slideshow item.`);
      }

      res.redirect(`/editHome?message=Slideshow item updated successfully.`);
    });
  } else if (!req.session.loggedin) {
    res.redirect('/login');
  } else {
    res.send('Access denied: Admin only');
  }
});





app.get('/addPartner', function (req, res){
  if (req.session.loggedin && req.userRole === 'parent') {

    res.render("addPartner", { message:null});
  
  } else if (!req.session.loggedin) {
    res.redirect('/login');  // Redirect to login if the user is not logged in
  } else {
    res.send('Access denied: Parent only');
  }
  
});


app.post('/addPartner', upload.single('picture'), function (req, res) {
  if (req.session.loggedin && req.userRole === 'parent') {

    const Email = req.session.email;
    const { first_name, last_name, email, gender, role, relationship, occupation, mobile, address } = req.body;


    let picture = req.file ? req.file.filename : null;
  //  console.log("Step 1: All data extracted");

    if (first_name && last_name && email && gender && role && relationship && occupation && mobile && address) {
      let sql1 = `INSERT INTO users (First_Name, Last_Name, Gender, Role, Email, Status) VALUES (?, ?, ?, ?, ?, ?)`;

      conn.query(sql1, [first_name, last_name, gender, role, email, 'pending'], (err, result) => {
        if (err) {
          console.error('Error inserting partner:', err);
          //return res.redirect('/addPartner?message=');
          res.render('addPartner', { message: 'Error adding partner.' });
        }
      //  console.log("Step 2: User inserted");

        let sql2 = 'INSERT INTO parent (Email, Relationship, Occupation, Mobile, Address, Picture) VALUES (?, ?, ?, ?, ?, ?)';
        conn.query(sql2, [email, relationship, occupation, mobile, address, picture], (err, result) => {
          if (err) {
            console.error('Error inserting parent:', err);
           // return res.redirect('/addPartner?message=');
            res.render('addPartner', { message: 'Error adding parent.' });
          }
         // console.log("Step 3: Parent information inserted");

          let sql3 = 'SELECT Child_ID FROM parent_child WHERE Parent_Email = ?';
          conn.query(sql3, [Email], (err, children) => {
            if (err) {
              console.error('Error getting child data:', err);
              //return res.redirect('/addPartner?message=E');
              res.render('addPartner', { message: 'Error getting child data.' });
            }
           // console.log("Step 4: Fetched children:", children);
            // Check if any children were found
            if (children.length > 0) {
              // Loop through each child and insert the association
              let insertCount = 0; // Counter to track completed inserts
              children.forEach(child => {
                let sql4 = 'INSERT INTO parent_child (Child_ID, Parent_Email) VALUES (?, ?)';
                conn.query(sql4, [child.Child_ID, email], (err, result) => {
                  if (err) {
                    console.error('Error associating child with parent:', err);
                    //return res.redirect('/addPartner?message=Error adding parent to child association.');
                    res.render('addPartner', { message: 'Error adding parent to child association.' });
                  }

                  // Log success for each child association
                //  console.log(`Successfully associated Child_ID: ${child.Child_ID} with Parent_Email: ${email}`);
                  insertCount++;

                  // Redirect if all inserts are done
                  if (insertCount === children.length) {
                    //return res.redirect('/addPartner?message=Successfully associated children with parent.');
                    res.render('addPartner', { message: 'Successfully associated children with parent.' });
                  }
                });
              });
            } else {
             // console.log("Step 6: No children found");
              //return res.redirect('/addPartner?message=No children found for this parent email.');
              res.render('addPartner', { message: 'No children found for this parent email.' });
            }
          });
        });
      });
    } else {
      //console.log("Step 0: Missing fields");
      res.redirect('/addPartner?message=All fields are required');
    }
  } else if (!req.session.loggedin) {
    res.redirect('/login');  // Redirect to login if the user is not logged in
  } else {
    res.send('Access denied: Parent only');
  }
});

// Route to display gallery
app.get('/gallery', (req, res) => {
  let sql = 'SELECT * FROM gallery ORDER BY created_at ASC';
  conn.query(sql, (err, results) => {
      if (err) throw err;


      const sql1 = `
  SELECT e.id, e.title, e.description, DATE_FORMAT(e.event_date, "%Y-%m-%d") AS event_date, ei.image_url
FROM events e
INNER JOIN event_images ei ON e.id = ei.event_id
ORDER BY e.event_date ASC`;
  
  conn.query(sql1, (err, result) => {
      if (err) throw err;

      const events = result.reduce((acc, row) => {
          if (!acc[row.id]) {
              acc[row.id] = {
                  id: row.id,
                  title: row.title,
                  description: row.description,
                  event_date: row.event_date,
                  images: []
              };
          }
          acc[row.id].images.push(row.image_url);
          return acc;
      }, {});

      
      res.render('gallery', { events: Object.values(events),images: results });
  });
     
  });
});

// Render form to upload image
app.get('/add_gallery', (req, res) => {
  if (req.session.loggedin && req.userRole === 'admin') {
  const sql = 'SELECT id, title, description, event_date FROM events ORDER BY event_date ASC';
  conn.query(sql, (err, results) => {
      if (err) throw err;
      res.render('add_gallery', { events: results });
  });
} else if (!req.session.loggedin) {
  res.redirect('/login');  // Redirect to login if the user is not logged in
} else {
  res.send('Access denied: Admin only');
}
});

app.post('/add-event-photos', upload.array('images', 10), (req, res) => {
  if (req.session.loggedin && req.userRole === 'admin') {
  const eventId = req.body.event_id;
  const images = req.files.map(file => file.filename);

  images.forEach(image => {
      const sql = 'INSERT INTO event_images (event_id, image_url) VALUES (?, ?)';
      conn.query(sql, [eventId, image], (err) => {
          if (err) throw err;
      });
  });

  res.redirect('/gallery');
} else if (!req.session.loggedin) {
  res.redirect('/login');  // Redirect to login if the user is not logged in
} else {
  res.send('Access denied: Admin only');
}
});

// Handle image upload form
app.post('/add-gallery', upload.single('image'), (req, res) => {
  if (req.session.loggedin && req.userRole === 'admin') {
  const image_url = `/uploads/${req.file.filename}`;
  const { description } = req.body;
  let sql = 'INSERT INTO gallery (image_url, description) VALUES (?, ?)';
  conn.query(sql, [image_url, description], (err, result) => {
      if (err) throw err;
      res.redirect('/gallery');
  });
} else if (!req.session.loggedin) {
  res.redirect('/login');  // Redirect to login if the user is not logged in
} else {
  res.send('Access denied: Admin only');
}
});

app.get('/events', (req, res) => {

  res.render('events');  // This renders the 'events.ejs' view
});

// Fetch news and events from database
app.get('/news_events', (req, res) => {
  let sql = 'SELECT * FROM events ORDER BY event_date ASC';
  conn.query(sql, (err, result) => {
      if (err) throw err;
      res.render('news_events', { events: result });
  });
});


app.get('/add_news_event', (req, res) => {
  if (req.session.loggedin && req.userRole === 'admin') {
  conn.query("SELECT event_date FROM events", (error, rows) => {
    if (error) {
      console.error("Error fetching event dates:", error);
      return res.status(500).send("Server error");
    }
    // Convert to local date string to avoid timezone offset issues
    const eventDates = rows.map(event => {
      const date = new Date(event.event_date);
      return date.toLocaleDateString('en-CA'); // 'en-CA' produces "YYYY-MM-DD" format
    });
    res.render('add_news_event', { eventDates });
  });
} else if (!req.session.loggedin) {
  res.redirect('/login');  // Redirect to login if the user is not logged in
} else {
  res.send('Access denied: Admin only');
}
});

app.post('/add-news-event', upload.single('picture'), (req, res) => {
  if (req.session.loggedin && req.userRole === 'admin') {
  const { title, description, event_date } = req.body;
  let picture = req.file ? req.file.filename : null;

  // Now insert data into the database
  let sql = 'INSERT INTO events (title, description, event_date, picture) VALUES (?, ?, ?, ?)';
  conn.query(sql, [title, description, event_date, picture], (err, result) => {
      if (err) throw err;
      res.redirect('/events');
  });
} else if (!req.session.loggedin) {
  res.redirect('/login');  // Redirect to login if the user is not logged in
} else {
  res.send('Access denied: Admin only');
}
});

// API route to fetch events for a specific month and year
app.get('/api/events/:year/:month', (req, res) => {
  const year = req.params.year;
  const month = req.params.month;

  const sql = `
  SELECT * FROM events 
  WHERE YEAR(event_date) = ? AND MONTH(event_date) = ?
  ORDER BY event_date ASC`;
  
  conn.query(sql, [year, month], (err, result) => {
      if (err) throw err;
      res.json(result);

  });
});




// Handle form submission with multiple image uploads
app.post('/add-event', upload.array('images', 10), (req, res) => {
  if (req.session.loggedin && req.userRole === 'admin') {
  const { title, description, event_date } = req.body;

  // Insert event details
  let sql = 'INSERT INTO events (title, description, event_date) VALUES (?, ?, ?)';
  conn.query(sql, [title, description, event_date], (err, result) => {
      if (err) throw err;

      const eventId = result.insertId;

      // Insert each image into event_images table
      const imageFiles = req.files;
      if (imageFiles.length > 0) {
          let imageSql = 'INSERT INTO event_images (event_id, image_url) VALUES ?';
          let values = imageFiles.map(file => [eventId, `/uploads/${file.filename}`]);

          conn.query(imageSql, [values], (err, result) => {
              if (err) throw err;
              res.redirect('/gallery');
          });
      } else {
          res.redirect('/gallery');
      }
  });
} else if (!req.session.loggedin) {
  res.redirect('/login');  // Redirect to login if the user is not logged in
} else {
  res.send('Access denied: Admin only');
}
});


app.post('/feedbackInbox', function(req, res) {
  if (req.session.loggedin && (req.userRole === 'teacher' || req.userRole === 'parent')) {
    const feedback = req.body.feedback;
    const id = req.body.id; 
    const message = "Added feedback successfully.";

   // console.log(feedback);
  //  console.log(id);

    // Update the feedback in the `message` table
    conn.query('UPDATE message SET Feedback = ? WHERE ID = ?', [feedback, id], function(err) {
      if (err) {
        console.error("Error updating feedback:", err);
        return res.status(500).send("Error updating feedback");
      }
      
      // Conditional redirect based on user role
      if (req.userRole === 'teacher') {
        res.redirect('/teacherInbox?message=' + encodeURIComponent(message));
      } else if (req.userRole === 'parent') {
        res.redirect('/parentInbox?message=' + encodeURIComponent(message));
      }
    });
  } else if (!req.session.loggedin) {
    res.redirect('/login');
  } else {
    // Custom access denied message specifying role
    res.send('Access denied: only teachers or parents can access this page');
  }
});

app.post('/deleteMsg', function(req, res) {
  if (req.session.loggedin && (req.userRole === 'teacher' || req.userRole === 'parent')) {
   
    const id = req.body.id; 
    const message = "Message deleted successfully.";

   

    conn.query('DELETE FROM message WHERE ID = ?', [id], function(err) {
      if (err) {
        console.error("Error deleting message:", err);
        return res.status(500).send("Error deleting message");
      }
      
      // Conditional redirect based on user role
      if (req.userRole === 'teacher') {
        res.redirect('/teacherInbox?message=' + encodeURIComponent(message));
      } else if (req.userRole === 'parent') {
        res.redirect('/parentInbox?message=' + encodeURIComponent(message));
      }
    });
  } else if (!req.session.loggedin) {
    res.redirect('/login');
  } else {
    // Custom access denied message specifying role
    res.send('Access denied: only teachers or parents can access this page');
  }
});

app.post('/deleteSendMsg', function(req, res) {
  if (req.session.loggedin && (req.userRole === 'teacher' || req.userRole === 'parent')) {
   
    const id = req.body.id; 
    const message = "Message deleted successfully.";

   

    conn.query('DELETE FROM message WHERE ID = ?', [id], function(err) {
      if (err) {
        console.error("Error deleting message:", err);
        return res.status(500).send("Error deleting message");
      }
      
      // Conditional redirect based on user role
      if (req.userRole === 'teacher') {
        res.redirect('/teacherSendMsg?message=' + encodeURIComponent(message));
      } else if (req.userRole === 'parent') {
        res.redirect('/parentSendMsg?message=' + encodeURIComponent(message));
      }
    });
  } else if (!req.session.loggedin) {
    res.redirect('/login');
  } else {
    // Custom access denied message specifying role
    res.send('Access denied: only teachers or parents can access this page');
  }
});
// Helper function to render teacherMsg with required data
function renderTeacherSendMsg(req, res, message = "") {
  const email = req.session.email;
  conn.query("SELECT * FROM child", function (err, children) {
    if (err) {
      console.error("Error fetching children:", err);
      return res.status(500).send("Error fetching children");
    }

    conn.query(
      "SELECT pc.Child_ID, p.Relationship, p.Email FROM parent p INNER JOIN parent_child pc ON p.Email = pc.Parent_Email",
      function (err, parents) {
        if (err) {
          console.error("Error fetching parents:", err);
          return res.status(500).send("Error fetching parents");
        }

        // Organize parents by child ID
        const parentsByChild = {};
        parents.forEach((parent) => {
          if (!parentsByChild[parent.Child_ID]) {
            parentsByChild[parent.Child_ID] = [];
          }
          parentsByChild[parent.Child_ID].push(parent);
        });

        // Query to get the parent (from users) and child names (from child table) along with the message data
        conn.query(
          `SELECT c.First_Name AS Child_First_Name, 
                  c.Last_Name AS Child_Last_Name, 
                   p.Relationship,
                  u.First_Name AS Parent_First_Name, 
                  u.Last_Name AS Parent_Last_Name, 
                  m.*
           FROM message m
           JOIN users u ON m.Receiver = u.Email
           JOIN child c ON m.Child = c.ID
           JOIN parent p ON m.Receiver = p.Email
           WHERE m.Sender = ?`, 
           [email], 
          function (err, manageMsgData) {
            if (err) {
              console.error("Error fetching manage message data:", err);
              return res.status(500).send("Error fetching manage message data");
            }

            // Render the view with all the necessary data
            res.render("teacherSendMsg", {
              children: children,
              parentsByChild: parentsByChild,
              userRole: req.session.userRole,
              message: message,
              manageMsgData: manageMsgData,
            });
          }
        );
      }
    );
  });
}

// GET route for /teacherMsg
app.get('/teacherSendMsg', function (req, res) {
  if (req.session.loggedin && req.session.userRole === 'teacher') {
    renderTeacherSendMsg(req, res);
  } else if (!req.session.loggedin) {
    res.redirect('/login');  // Redirect to login if the user is not logged in
  } else {
    res.send('Access denied: Teachers only');
  }

});

// POST route for /teacherMsg
app.post('/teacherSendMsg', function (req, res) {
  if (req.session.loggedin && req.session.userRole === 'teacher') {
    const { child, topic, message, parent } = req.body;
    const email = req.session.email;

    // Insert the message into the `message` table
    conn.query(
      'INSERT INTO message (Child, Receiver, Topic, Message, Sender) VALUES (?, ?, ?, ?, ?)',
      [child, parent, topic, message, email],
      function (err) {
        if (err) {
          console.error("Error inserting message:", err);
          return res.status(500).send("Error saving the message");
        }

        // Call the helper function with a success message
        renderTeacherSendMsg(req, res, "Message sent successfully. Thank you!");
      }
    );
  } else if (!req.session.loggedin) {
    res.redirect('/login');  // Redirect to login if the user is not logged in
  } else {
    res.send('Access denied: Teachers only');
  }

});

app.get('/parentInbox', function(req, res) {
  if (req.session.loggedin && req.userRole === 'parent') {
    const message = req.query.message;
    const email = req.session.email; 

    // Query to get the parent (from users) and child names (from child table) along with the message data
    conn.query(
      `SELECT u.First_Name AS Teacher_First_Name, 
              u.Last_Name AS Teacher_Last_Name, 
              c.First_Name AS Child_First_Name, 
              c.Last_Name AS Child_Last_Name, 
              m.*
       FROM message m
       JOIN users u ON m.Sender = u.Email
       JOIN child c ON m.Child = c.ID
       JOIN teachers t ON m.Sender = t.Email
       WHERE m.Receiver = ?`, [email], 
      function(err, result) {
        if (err) throw err;
      
        res.render('parentInbox', { 
          title: 'Manage User',
          manageMsgData: result,
          message: message,  
         // userRole: req.userRole
        });
      }
    );
  } else if (!req.session.loggedin) {
    res.redirect('/login');
  } else {
    res.send('Access denied: Parents only');
  }
});

function renderChildParentList(req, res, viewName) {
  if (req.session.loggedin && (req.userRole === 'teacher' || req.userRole === 'admin')) {

    // Query to get the parent (from users) and child names (from child table) along with the message data
    conn.query(
      `SELECT 
    c.First_Name AS Child_First_Name, 
    c.Last_Name AS Child_Last_Name, 
    c.Picture AS Child_Picture, 

    -- Father's details
    MAX(CASE WHEN father_p.Relationship = 'father' THEN father_u.First_Name END) AS Father_First_Name, 
    MAX(CASE WHEN father_p.Relationship = 'father' THEN father_u.Last_Name END) AS Father_Last_Name,
    MAX(CASE WHEN father_p.Relationship = 'father' THEN father_p.Picture END) AS Father_Picture, 

    -- Mother's details
    MAX(CASE WHEN mother_p.Relationship = 'mother' THEN mother_u.First_Name END) AS Mother_First_Name, 
    MAX(CASE WHEN mother_p.Relationship = 'mother' THEN mother_u.Last_Name END) AS Mother_Last_Name,
    MAX(CASE WHEN mother_p.Relationship = 'mother' THEN mother_p.Picture END) AS Mother_Picture,

    -- Authorized Person details
    GROUP_CONCAT(CASE WHEN pop.Parent_Email = father_u.Email THEN pop.ID END) AS Authorized_Person_ID,
    GROUP_CONCAT(CASE WHEN pop.Parent_Email = father_u.Email THEN pop.Name END) AS Authorized_Person_Name,
    GROUP_CONCAT(CASE WHEN pop.Parent_Email = father_u.Email THEN pop.Reason END) AS Authorized_Person_Reason,
    GROUP_CONCAT(CASE WHEN pop.Parent_Email = father_u.Email THEN pop.Relationship END) AS Authorized_Person_Relationship,
    GROUP_CONCAT(CASE WHEN pop.Parent_Email = father_u.Email THEN pop.Picture END) AS Authorized_Person_Picture,
    GROUP_CONCAT(CASE WHEN pop.Parent_Email = father_u.Email THEN pop.Mobile END) AS Authorized_Person_Mobile,
    GROUP_CONCAT(CASE WHEN pop.Parent_Email = father_u.Email THEN pop.Status END) AS Authorized_Person_Status,

    GROUP_CONCAT(CASE WHEN pop.Parent_Email = mother_u.Email THEN pop.ID END) AS Authorized_Person_ID,
    GROUP_CONCAT(CASE WHEN pop.Parent_Email = mother_u.Email THEN pop.Name END) AS Authorized_Person_Name,
    GROUP_CONCAT(CASE WHEN pop.Parent_Email = mother_u.Email THEN pop.Reason END) AS Authorized_Person_Reason,
    GROUP_CONCAT(CASE WHEN pop.Parent_Email = mother_u.Email THEN pop.Relationship END) AS Authorized_Person_Relationship,
    GROUP_CONCAT(CASE WHEN pop.Parent_Email = mother_u.Email THEN pop.Picture END) AS Authorized_Person_Picture,
    GROUP_CONCAT(CASE WHEN pop.Parent_Email = mother_u.Email THEN pop.Mobile END) AS Authorized_Person_Mobile,
    GROUP_CONCAT(CASE WHEN pop.Parent_Email = mother_u.Email THEN pop.Status END) AS Authorized_Person_Status

FROM 
    parent_child pc
JOIN 
    child c ON pc.Child_ID = c.ID
LEFT JOIN 
    users father_u ON pc.Parent_Email = father_u.Email
LEFT JOIN 
    parent father_p ON father_p.Email = father_u.Email AND father_p.Relationship = 'father'
LEFT JOIN 
    users mother_u ON pc.Parent_Email = mother_u.Email
LEFT JOIN 
    parent mother_p ON mother_p.Email = mother_u.Email AND mother_p.Relationship = 'mother'
LEFT JOIN 
    pickup_dropoff_persons pop ON (pop.Parent_Email = father_u.Email OR pop.Parent_Email = mother_u.Email)

GROUP BY 
    c.ID`, 
      function(err, result) {
        if (err) throw err;

        res.render(viewName, { 
          showData: result, 
        });
      }
    );
  } else if (!req.session.loggedin) {
    res.redirect('/login');
  } else {
    res.send('Access denied: teacher and admin only');
  }
}

// Route for viewing child-parent list
app.get('/childParentList', function(req, res) {
  if (req.session.loggedin && req.userRole === 'teacher') {
  renderChildParentList(req, res, 'childParentList');
} else if (!req.session.loggedin) {
  res.redirect('/login');
} else {
  res.send('Access denied: Teachers only');
}
});

// Route for adding child-parent list (admin only)
app.get('/addChildParentList', function(req, res) {
  if (req.userRole === 'admin') {
    renderChildParentList(req, res, 'addChildParentList');
  } else if (!req.session.loggedin) {
    res.redirect('/login');
  } else {
    res.send('Access denied: Admin only');
  }
});

//This for pickup_dropoff admin approval
app.post('/approvePerson', function(req, res) {
  if (req.session.loggedin && req.userRole === 'admin') {
    let id = req.body.id;
    let Status = req.body.status;
    let sql = `UPDATE pickup_dropoff_persons SET Status = ? WHERE ID = ?`;
    // Update user status in the database
    conn.query(sql, [Status, id], function(err, result) {
      if (err) throw err;

       renderChildParentList(req, res, 'addChildParentList');

    });
  } else if (!req.session.loggedin) {
    res.redirect('/login');
  } else {
    res.send('Access denied: Admin only');
  }
});

app.post('/deletePerson', function(req, res) {
  if (req.session.loggedin && req.userRole === 'admin') {
    let id = req.body.id;
   
    let sql = `DELETE FROM pickup_dropoff_persons WHERE ID = ?`;
    // Update user status in the database
    conn.query(sql, [id], function(err, result) {
      if (err) throw err;

       renderChildParentList(req, res, 'addChildParentList');

    });
  } else if (!req.session.loggedin) {
    res.redirect('/login');
  } else {
    res.send('Access denied: Admin only');
  }
});



app.post('/updateHomeContent', (req, res) => {
  if (req.session.loggedin && req.userRole === 'admin') {
  const content1 = req.body.content1;
  const content2 = req.body.content2;
  const content3 = req.body.content3;
  const content4 = req.body.content4;
  const content5 = req.body.content5;
  // Add more variables as needed

  // Update each content type in the database
  const updateQueries = [
    { content: content1, type: '1' },
    { content: content2, type: '2' },
    { content: content3, type: '3' },
    { content: content4, type: '4' },
    { content: content5, type: '5' },
    // Add more as needed
  ];

  updateQueries.forEach(({ content, type }) => {
    conn.query(
      'UPDATE pages SET content = ? WHERE Content_Type = ? AND Name = "home"',
      [content, type],
      (err) => {
        if (err) throw err;
      }
    );
  });

  res.redirect('/');
} else if (!req.session.loggedin) {
  res.redirect('/login');  // Redirect to login if the user is not logged in
} else {
  res.send('Access denied: Admin only');
}
});

app.get('/editHome', function(req, res) {
  if (req.session.loggedin && req.userRole === 'admin') { // Only allow admin access
    // Query to retrieve the current homepage content from the database
    conn.query(
      `SELECT Content_Type, Content FROM pages WHERE Name = 'home' ORDER BY Content_Type`, 
      function(err, result) {
        if (err) throw err;

        let slideshowQuery = "SELECT * FROM slideshow";

    conn.query(slideshowQuery, (err, slideshowResult) => {
      if (err) throw err;

     
   


        // Render editHome page with the current content
        res.render('editHome', { 
          homepageContent: result,
          slideshow: slideshowResult
        });
      });
      }
    );
  } else if (!req.session.loggedin) {
    res.redirect('/login'); // Redirect to login if not logged in
  } else {
    res.send('Access denied: admin only'); // Deny access if not admin
  }
});

app.get('/editAboutUs', (req, res) => {
  // Check if user is logged in and has the admin role
  if (req.session.loggedin && req.userRole === 'admin') {
    const query = 'SELECT Image_Url, Content_Type, Content FROM pages WHERE Name = "aboutUs" ORDER BY Content_Type'; // Adjust the table name as needed
    
    conn.query(query, (err, results) => {
      if (err) throw err;
      res.render('editAboutUs', { pageContent: results }); // Send data to the view
    });
  } else {
    res.redirect('/login');
  }
});

app.post('/editAboutUs', upload.single('aboutpic'), (req, res) => {
  // Prepare data for each content type
  const updatedContent = [
    { Content_Type: '1', Content: req.body.content1 },
    { Content_Type: '2', Content: req.body.content2 },
    { Content_Type: '3', Content: req.body.content3 },
    { Content_Type: '4', Content: req.body.content4 },
    { Content_Type: '5', Content: req.body.content5 },
  ];

  // Update each content type in the database
  updatedContent.forEach((item) => {
    const query = 'UPDATE pages SET Content = ? WHERE Name = "aboutUs" AND Content_Type = ?';
    conn.query(query, [item.Content, item.Content_Type], (err) => {
      if (err) throw err;
    });
  });

  // If an image file is uploaded, update the image URL in the database
  if (req.file) {
    const imageUrl = `/uploads/${req.file.filename}`;
    const query = 'UPDATE pages SET Image_Url = ? WHERE Content_Type = "6"';
    conn.query(query, [imageUrl], (err) => {
      if (err) throw err;
    });
  }

  res.redirect('/aboutUs'); // Redirect back to the About Us page to view updates
});

app.get('/updateKai', (req, res) => {
  let query =  " SELECT child.ID,  child.First_Name, child.Last_Name, child.Picture,  kai.Before_Picture,  kai.After_Picture, kai.Note FROM child LEFT JOIN kai ON child.ID = kai.Child_ID GROUP BY child.ID ORDER BY kai.id DESC";
  conn.query(query, (err, results) => {
     if (err) throw err;

     
     res.render('updateKai', { showData: results }); // Render view with data
  });
});





app.post('/uploadBeforeKai', upload.single('beforeKaiImage'), (req, res) => {
  const { childId } = req.body;
  const beforeKaiImage = req.file.filename;

  let sql= 'INSERT INTO kai (Before_Picture, After_Picture, Child_ID,Note) VALUES (?,?,?,?)'; 
  
  conn.query(sql,[beforeKaiImage, '', childId,''], (err) => {
    if (err) throw err;

  res.redirect('/updateKai'); // Redirect to the relevant page
});
});

// Route to upload afterKaai image
app.post('/uploadAfterKai', upload.single('afterKaiImage'), (req, res) => {
  const { childId } = req.body; 
  const afterKaiImage = req.file.filename;
  
  conn.query(
    'UPDATE kai SET After_Picture = ? WHERE Child_ID = ? ',
    [afterKaiImage, childId],
    (err) => {
      if (err) throw err;
      res.redirect('/updateKai');
    }
  );
 
  
  
});

app.post('/addNote', (req, res) => {
  const { childId, note} = req.body; 

  
  let sql= 'UPDATE kai SET Note = ? WHERE Child_ID = ?'; 
 
  
  conn.query(sql,[note, childId], (err) => {
    if (err) throw err;
  res.redirect('/updateKai');
});
});


app.get('/addNew', function(req, res) {
  if (req.session.loggedin && req.userRole === 'parent') {
    const message = req.query.message;
    const email = req.session.email;

    // Fetch profile data
    conn.query("SELECT * FROM pickup_dropoff_persons WHERE Parent_Email = ?", [email], function(err, result) {
      if (err) {
        console.error("Error fetching profile:", err);
        return res.render('addNew', { 
          message: 'Error fetching profile data',
          data: null,
          editMode: false
        });
      }
     

      // Check if there is existing data for this parent
      if (result.length === 0) {
        res.render('addNew', { 
          message: '',
          data: null,
          editMode: true // No existing data, so set to "add" mode
        });
      } else {
        res.render('addNew', { 
          message: message,
          data: result[0],
          editMode: true // Data exists, so set to "edit" mode
        });
      }
    });
  } else if (!req.session.loggedin) {
    res.redirect('/login');
  } else {
    res.send('Access denied: Parents only');
  }
});


app.post('/addNew', upload.single('picture'), function(req, res) {
  if (req.session.loggedin && req.userRole === 'parent') {
    const email = req.session.email;
    const { reason, name, relationship, mobile } = req.body;
    let picture = req.file ? req.file.filename : null;
    
    // Insert new record
    conn.query(
      "INSERT INTO pickup_dropoff_persons (Reason, Name, Relationship, Mobile, Picture, Parent_Email) VALUES (?, ?, ?, ?, ?, ?)", 
      [reason, name, relationship, mobile, picture, email], 
      function(err, result) {
        if (err) {
          console.error("Error inserting data:", err); // Check if an error is thrown here
          return res.render('addNew', { 
            message: 'Error adding new authorized person', 
            data: null, 
            editMode: true 
          });
        }
        res.redirect('/updateAddNew?message=Data inserted successfully');
      }
    );
  } else if (!req.session.loggedin) {
    res.redirect('/login');
  } else {
    res.send('Access denied: Parents only');
  }
});


app.post('/updateAddNew', upload.single('picture'), function(req, res) {
  if (req.session.loggedin && req.userRole === 'parent') {
    const email = req.session.email;
    const { reason, name, relationship, mobile } = req.body;
    let picture = req.file ? req.file.filename : req.body.oldPicture;
    let status = "pending";

    // Update the existing record
    conn.query("UPDATE pickup_dropoff_persons SET Reason = ?, Name = ?, Relationship = ?, Mobile = ?, Picture = ? Status = ? WHERE Parent_Email = ?", 
    [reason, name, relationship, mobile, picture, status, email], function(err, result) {
      if (err) {
        console.error("Error updating data:", err);
        return res.render('addNew', { 
          message: 'Error updating data',
          data: req.body,
          editMode: true
        });
      }
      res.redirect('/updateAddNew?message=Data updated successfully');
    });
  } else if (!req.session.loggedin) {
    res.redirect('/login');
  } else {
    res.send('Access denied: Parents only');
  }
});

app.get('/updateAddNew', function(req, res) {
  if (req.session.loggedin && req.userRole === 'parent') {
    const email = req.session.email;
    const message = req.query.message || '';

    // Fetch existing data for the parent
    conn.query("SELECT * FROM pickup_dropoff_persons WHERE Parent_Email = ?", [email], function(err, result) {
      if (err) {
        console.error("Error fetching profile:", err);
        return res.render('addNew', { 
          message: 'Error fetching profile data',
          data: null,
          editMode: false
        });
      }

      // If entry exists, show it in edit mode
      if (result.length > 0) {
        res.render('addNew', { 
          message: message,
          data: result[0],
          editMode: true
        });
      } else {
        // If no data exists, redirect to add a new entry
        res.redirect('/addNew?message=No existing entry found. Please add a new authorized person.');
      }
    });
  } else if (!req.session.loggedin) {
    res.redirect('/login');
  } else {
    res.send('Access denied: Parents only');
  }
});

app.post('/deleteAddNew', function (req, res) {
  if (req.session.loggedin && req.userRole === 'parent') {
    const id = req.body.id;

    if (!id) {
      return res.render('addNew', {
        message: 'Error: No ID provided for deletion',
        data: null,
        editMode: false
      });
    }

    // Perform the deletion
    conn.query("DELETE FROM pickup_dropoff_persons WHERE ID = ?", [id], function (err, result) {
      if (err) {
        console.error("Error deleting data:", err);
        return res.render('addNew', {
          message: 'Error deleting the authorized person',
          data: null,
          editMode: false
        });
      }

      // Redirect to add new or appropriate route
      res.redirect('/addNew?message=Authorized person deleted successfully');
      //res.render('/addNew', { message: 'Authorized person deleted successfully' });
    });
  } else if (!req.session.loggedin) {
    res.redirect('/login');
  } else {
    res.send('Access denied: Parents only');
  }
});







// GET logout - logs out the user
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

app.listen(3000);
console.log('Node app is running on port 3000');