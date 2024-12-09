var conn = require('./dbConfig');

function hasPartnerMiddleware(req, res, next) {
  // Ensure that session and email exist before querying
  if (!req.session || !req.session.email) {
    return next(); // Skip if email is not in the session
  }

  const email = req.session.email;

  // Define the query to count the partners
  const query = `
    SELECT COUNT(DISTINCT Parent_email) AS partnerCount
    FROM parent_child
    WHERE Child_ID IN (
      SELECT Child_ID 
      FROM parent_child 
      WHERE Parent_email = ?
    );
  `;

  // Execute the query
  conn.query(query, [email], (err, result) => {
    if (err) {
      console.error("Error executing query:", err);
      res.locals.hasPartner = false; // Default to false in case of an error
      return next();
    }

    // Set hasPartner to true if the count is greater than 0, else false
    res.locals.hasPartner = result[0].partnerCount === 2;
    next(); // Proceed to the next middleware or route
  });
}

module.exports = hasPartnerMiddleware;
