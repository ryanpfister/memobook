const express = require('express');
const bodyParser = require('body-parser');
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { db, admin } = require('./firebase-admin'); // Use Admin SDK for Firestore and server-side operations
const { auth, createUserWithEmailAndPassword, signInWithEmailAndPassword } = require('./firebase-client'); // Use Client SDKs
const nodemailer = require('nodemailer');
const pdfDirectory = path.join(__dirname, 'pdfs');
if (!fs.existsSync(pdfDirectory)) {
    fs.mkdirSync(pdfDirectory, { recursive: true });
}
const { Timestamp } = require('firebase-admin/firestore'); // Import Firestore Timestamp
const app = express();
const { v4: uuidv4 } = require('uuid'); // Import the UUID function
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views')); // Make sure this matches your views directory
// Transporter for sending emails
const transporter = nodemailer.createTransport({
    host: 'smtp.mailgun.org', // Replace with your SMTP server host
    port: 587,                   // Replace with your SMTP server port
    secure: false,               // Set to true if your server uses SSL/TLS
    auth: {
        user: 'tob@status.rdpfister.com', // Replace with your SMTP server user email
        pass: '8114f9ac2e514597790fc253363591e7-777a617d-ecf199a9'         // Replace with your SMTP server password
    }
});


const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir); // Create the logs directory if it doesn't exist
}
// Middleware to check if user is logged in
async function isAuthenticated(req, res, next) {
    const user = auth.currentUser;

    if (user) {
        try {
            // Fetch user data from Firestore
            const userDoc = await db.collection('users').doc(user.uid).get();
            if (userDoc.exists) {
                req.user = {
                    ...userDoc.data(),
                    uid: user.uid
                };
                next();
            } else {
                res.redirect('/login');
            }
        } catch (error) {
            console.error('Error fetching user data:', error);
            res.redirect('/login');
        }
    } else {
        res.redirect('/login');
    }
}
app.use(express.static(path.join(__dirname, 'public')));


// Home route
app.get('/', (req, res) => {
    res.render('index');
});

app.get('/cad', isAuthenticated, (req, res) => {
    const { tourId } = req.query;
    const badgeNumber = req.user.badgeNumber; // Get badge number from the user session
    const logFilePath = path.join(logsDir, `${tourId}.json`);

    if (fs.existsSync(logFilePath)) {
        const data = JSON.parse(fs.readFileSync(logFilePath, 'utf8'));

        if (data.badgeNumber !== badgeNumber) {
            return res.status(403).send('Access denied: You do not have permission to view this tour log.');
        }

        res.render('cad', {
            tourId: tourId,
            badgeNumber: badgeNumber,
            officerName: req.user.name,
            logData: data
        });
    } else {
        res.status(404).send('Tour log not found');
    }
});


// Register route
app.get('/register', (req, res) => {
    res.render('register');
});

app.post('/register', async (req, res) => {
    const { email, password, officerName, badgeNumber } = req.body;

    if (!email || !password || !officerName || !badgeNumber) {
        return res.status(400).send('All fields are required');
    }

    try {
        // Create user with Firebase Authentication
        const userCredential = await createUserWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;

        // Save additional user information in Firestore
        await db.collection('users').doc(user.uid).set({
            email: user.email,
            officerName: officerName,
            badgeNumber: badgeNumber,
            isSupervisor: false, // Default to false
            createdAt: new Date()
        });

        res.status(201).send('User registered successfully');
    } catch (error) {
        res.status(400).send('Error creating user: ' + error.message);
    }
});
app.get('/login', (req, res) => {
    res.render('login');
});
app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        await signInWithEmailAndPassword(auth, email, password);
        res.redirect('/dashboard');
    } catch (error) {
        res.send('Error logging in: ' + error.message);
    }
});


app.get('/supervisors', async (req, res) => {
    try {
        const usersSnapshot = await db.collection('users').get();
        const users = usersSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // Pass users data to the template
        res.render('supervisors', { users });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).send('Error fetching users');
    }
});

// Route to start a new tour
app.get('/start-tour', isAuthenticated, (req, res) => {
    const currentDate = new Date();
    const fatReturnDate = new Date();
    fatReturnDate.setDate(currentDate.getDate() + ((4 - currentDate.getDay()) + 7) % 7 + 7);  // Set FAT Return Date to 2 Thursdays from now

    res.render('start-tour', {
        currentDate: currentDate.toLocaleDateString(),
        fatReturnDate: fatReturnDate.toISOString().split('T')[0], // Format as YYYY-MM-DD
        supervisors: ["Supervisor A", "Supervisor B", "Supervisor C"] // Example supervisors, replace with actual data
    });
});

app.post('/start-tour', isAuthenticated, (req, res) => {
    const { tour, vehicleNumber, radioNumber, scannerNumber, tabletNumber, fatReturnDate, callsign, supervisor, startMileage } = req.body;
    const currentDate = new Date();
    const tourId = uuidv4(); // Generate a unique UUID
    const logFilePath = path.join(logsDir, `${tourId}.json`);

    const tourLogData = {
        badgeNumber: req.user.badgeNumber,
        date: currentDate.toISOString(),
        tour,
        vehicleNumber,
        radioNumber,
        scannerNumber,
        tabletNumber,
        fatReturnDate,
        callsign,
        supervisor,
        startMileage,
        activities: [] // Empty array for logging activities
    };

    fs.writeFile(logFilePath, JSON.stringify(tourLogData, null, 2), (err) => {
        if (err) {
            console.error('Error writing tour log file:', err);
            return res.status(500).send('Error saving tour log');
        }

        res.redirect(`/cad?tourId=${tourId}`);
    });
});

app.get('/dashboard', isAuthenticated, (req, res) => {
    const badgeNumber = req.user.badgeNumber; // Get badge number from the user session
    fs.readdir(logsDir, (err, files) => {
        if (err) {
            console.error('Error reading logs directory:', err);
            return res.status(500).send('Error reading logs');
        }

        const userTours = files
            .filter(file => file.endsWith('.json'))
            .map(file => path.join(logsDir, file))
            .filter(filePath => {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                return data.badgeNumber === badgeNumber;
            })
            .map(filePath => {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                return {
                    id: path.basename(filePath, '.json'),
                    vehicleNumber: data.vehicleNumber,
                    startMileage: data.startMileage
                };
            });

        res.render('dashboard', {
            officerName: req.user.name,
            badgeNumber: badgeNumber,
            tours: userTours,
            isSupervisor: req.user.isSupervisor
        });
    });
});



// Route to log an activity
app.post('/log', isAuthenticated, (req, res) => {
    const { activity, tourId } = req.body;

    if (!activity || !tourId) {
        return res.status(400).send('Activity or Tour ID is missing');
    }

    const logFilePath = path.join(logsDir, `${tourId}.json`);

    fs.readFile(logFilePath, 'utf-8', (err, data) => {
        if (err) {
            console.error('Error reading tour log file:', err);
            return res.status(500).send('Error logging activity');
        }

        const tourLog = JSON.parse(data);
        tourLog.activities.push({
            activity,
            timestamp: new Date().toISOString()
        });

        fs.writeFile(logFilePath, JSON.stringify(tourLog, null, 2), (err) => {
            if (err) {
                console.error('Error updating tour log file:', err);
                return res.status(500).send('Error logging activity');
            }
            res.redirect(`/cad?tourId=${tourId}`);
        });
    });
});




// Route to log an event
app.post('/log-event', (req, res) => {
    const { event, timestamp, badgeNumber, tourId } = req.body;
    const logFilePath = path.join(logsDir, `${tourId}.json`);

    fs.readFile(logFilePath, 'utf8', (err, data) => {
        if (err) {
            if (err.code === 'ENOENT') {
                // If file doesn't exist, initialize a new log entry with activities array
                const newLogData = {
                    badgeNumber: badgeNumber,
                    date: new Date().toISOString(),
                    tour: tourId,
                    vehicleNumber: "",
                    radioNumber: "",
                    scannerNumber: "",
                    tabletNumber: "",
                    fatReturnDate: "",
                    callsign: "",
                    supervisor: "",
                    startMileage: "",
                    activities: [
                        {
                            event: event,
                            timestamp: timestamp,
                            badgeNumber: badgeNumber
                        }
                    ]
                };

                fs.writeFile(logFilePath, JSON.stringify(newLogData, null, 2), (writeErr) => {
                    if (writeErr) {
                        console.error('Error writing new log file:', writeErr);
                        return res.status(500).send('Error writing new log file');
                    }
                    res.send('Log entry saved successfully');
                });
            } else {
                console.error('Error reading log file:', err);
                return res.status(500).send('Error reading log file');
            }
        } else {
            let logData;
            try {
                logData = JSON.parse(data);
            } catch (parseError) {
                console.error('Error parsing log file data:', parseError);
                return res.status(500).send('Error parsing log file data');
            }

            // Ensure activities array exists
            if (!Array.isArray(logData.activities)) {
                logData.activities = [];
            }

            logData.activities.push({
                event: event,
                timestamp: timestamp,
                badgeNumber: badgeNumber
            });

            fs.writeFile(logFilePath, JSON.stringify(logData, null, 2), (writeErr) => {
                if (writeErr) {
                    console.error('Error writing log file:', writeErr);
                    return res.status(500).send('Error writing log file');
                }
                res.send('Log entry saved successfully');
            });
        }
    });
});

// Route to delete an event
app.post('/delete-log-entry', (req, res) => {
    const { tourId, timestamp } = req.body;
    
    // Construct file path
    const fileName = `${tourId}.json`; // Assuming file format is JSON
    const filePath = path.join(__dirname, 'logs', fileName);

    // Read the existing log file
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading log file:', err);
            return res.status(500).send('Error reading log file');
        }

        // Parse JSON data
        let logData;
        try {
            logData = JSON.parse(data);
        } catch (parseError) {
            console.error('Error parsing JSON:', parseError);
            return res.status(500).send('Error parsing log data');
        }

        // Remove the specific event
        logData.activities = logData.activities.filter(entry => entry.timestamp !== timestamp);

        // Save the updated log file
        fs.writeFile(filePath, JSON.stringify(logData, null, 2), 'utf8', (writeError) => {
            if (writeError) {
                console.error('Error writing log file:', writeError);
                return res.status(500).send('Error updating log file');
            }
            res.send('Log entry deleted successfully');
        });
    });
});

app.get('/get-logs', (req, res) => {
    const badgeNumber = req.query.badgeNumber; // Get badge number from query parameters
    const logsDir = path.join(__dirname, 'logs');
    
    fs.readdir(logsDir, (err, files) => {
        if (err) {
            return res.status(500).send('Error reading logs directory');
        }
        
        const filteredLogs = [];
        
        files.forEach(file => {
            if (path.extname(file) === '.json') {
                const filePath = path.join(logsDir, file);
                
                fs.readFile(filePath, 'utf8', (err, data) => {
                    if (err) {
                        console.error(`Error reading file ${file}: ${err}`);
                        return;
                    }
                    
                    const logData = JSON.parse(data);
                    
                    if (logData.badgeNumber === badgeNumber) {
                        filteredLogs.push(logData);
                    }
                });
            }
        });
        
        // Respond with filtered logs
        res.json(filteredLogs);
    });
});

app.get('/get-log-entries', (req, res) => {
    const { tourId } = req.query;
    const filePath = path.join(__dirname, 'logs', `${tourId}.json`);

    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading file:', err);
            return res.status(500).json({ error: 'Error reading log file' });
        }

        try {
            const logData = JSON.parse(data);
            // Ensure activities is an array
            if (!Array.isArray(logData.activities)) {
                logData.activities = []; // Default to empty array if not present or incorrectly formatted
            }
            res.json(logData);
        } catch (parseErr) {
            console.error('Error parsing JSON:', parseErr);
            res.status(500).json({ error: 'Error parsing log file' });
        }
    });
});




// Route to view a specific tour log
app.get('/tour/:id', isAuthenticated, (req, res) => {
    const tourId = req.params.id;
    const logFilePath = path.join(logsDir, `${tourId}.json`);

    fs.readFile(logFilePath, 'utf-8', (err, data) => {
        if (err) {
            console.error('Error reading tour log file:', err);
            return res.status(500).send('Error fetching tour log');
        }

        const tourData = JSON.parse(data);
        res.render('tour-log', { tour: tourData });
    });
});

// Route to resume a tour
app.post('/resume-tour', isAuthenticated, (req, res) => {
    const { tourId } = req.body;

    if (!tourId) {
        return res.status(400).send('Tour ID is missing');
    }

    const logFilePath = path.join(logsDir, `${tourId}.json`);

    fs.readFile(logFilePath, 'utf-8', (err, data) => {
        if (err) {
            console.error('Error reading tour log file:', err);
            return res.status(500).send('Error resuming tour');
        }

        const tourLog = JSON.parse(data);
        tourLog.status = 'active'; // Ensure status field exists or add it as needed

        fs.writeFile(logFilePath, JSON.stringify(tourLog, null, 2), (err) => {
            if (err) {
                console.error('Error updating tour log file:', err);
                return res.status(500).send('Error resuming tour');
            }
            res.send('Tour resumed successfully');
        });
    });
});
app.post('/edit-tour-log', isAuthenticated, (req, res) => {
    const { tourId, activityId, newActivity } = req.body;

    if (!tourId || !activityId || !newActivity) {
        return res.status(400).send('Missing parameters');
    }

    const logFilePath = path.join(logsDir, `${tourId}.json`);

    fs.readFile(logFilePath, 'utf-8', (err, data) => {
        if (err) {
            console.error('Error reading tour log file:', err);
            return res.status(500).send('Error editing tour log');
        }

        const tourLog = JSON.parse(data);
        const updatedActivities = tourLog.activities.map(activity =>
            activity.id === activityId ? { ...activity, text: newActivity } : activity
        );

        tourLog.activities = updatedActivities;

        fs.writeFile(logFilePath, JSON.stringify(tourLog, null, 2), (err) => {
            if (err) {
                console.error('Error updating tour log file:', err);
                return res.status(500).send('Error editing tour log');
            }
            res.send('Tour log entry updated successfully');
        });
    });
});
// Route to get the edit tour log page
app.get('/edit-tour-log/:id', isAuthenticated, (req, res) => {
    const tourId = req.params.id;
    const logFilePath = path.join(logsDir, `${tourId}.json`);

    fs.readFile(logFilePath, 'utf-8', (err, data) => {
        if (err) {
            console.error('Error reading tour log file:', err);
            return res.status(500).send('Error fetching tour log');
        }

        const tourData = JSON.parse(data);
        res.render('edit-tour-log', { tour: tourData });
    });
});

// Route to handle editing of the tour log
app.post('/edit-tour-log', isAuthenticated, (req, res) => {
    const { tourId, ...activities } = req.body;

    if (!tourId) {
        return res.status(400).send('Tour ID is missing');
    }

    const logFilePath = path.join(logsDir, `${tourId}.json`);

    fs.readFile(logFilePath, 'utf-8', (err, data) => {
        if (err) {
            console.error('Error reading tour log file:', err);
            return res.status(500).send('Error editing tour log');
        }

        const tourLog = JSON.parse(data);

        Object.keys(activities).forEach(activityId => {
            const activityIndex = tourLog.activities.findIndex(activity => activity.id === activityId);
            if (activityIndex > -1) {
                tourLog.activities[activityIndex] = { ...tourLog.activities[activityIndex], ...activities[activityId] };
            }
        });

        fs.writeFile(logFilePath, JSON.stringify(tourLog, null, 2), (err) => {
            if (err) {
                console.error('Error updating tour log file:', err);
                return res.status(500).send('Error editing tour log');
            }
            res.send('Tour log updated successfully');
        });
    });
});

app.get('/logout', (req, res) => {
    // Sign out using Firebase Client SDK
    auth.signOut()
        .then(() => {
            res.redirect('/login');
        })
        .catch((error) => {
            console.error('Error signing out:', error);
            res.status(500).send('Error signing out');
        });
});



app.post('/end-tour', isAuthenticated, (req, res) => {
    const { tourId, endMileage } = req.body;
    const logFilePath = path.join(logsDir, `${tourId}.json`); // Path to the existing log file

    // Define the PDF file name and path
    const filename = `${tourId}.pdf`; // PDF file name
    const filepath = path.join(logsDir, filename); // Path to the PDF file

    // Read the existing log file
    fs.readFile(logFilePath, 'utf8', (err, data) => {
        if (err) {
            console.error('Error reading log file:', err);
            return res.status(500).send('Error reading log file');
        }

        let logData;
        try {
            logData = JSON.parse(data);
        } catch (parseError) {
            console.error('Error parsing log file JSON:', parseError);
            return res.status(500).send('Error parsing log file');
        }

        // Update the log data with end mileage and status
        logData.endMileage = endMileage;
        logData.mileage = endMileage - parseInt(logData.startMileage, 10); // Calculate mileage
        logData.status = 'completed';

        // Write the updated log data back to the file
        fs.writeFile(logFilePath, JSON.stringify(logData, null, 2), (writeError) => {
            if (writeError) {
                console.error('Error writing log file:', writeError);
                return res.status(500).send('Error updating log file');
            }

            // Generate the PDF
            const doc = new PDFDocument();
            doc.pipe(fs.createWriteStream(filepath));

            doc.fontSize(16).text('Tour Log', { align: 'center' });
            doc.moveDown();
            doc.fontSize(12).text(`Tour ID: ${logData.tour}`);
            doc.text(`Vehicle Number: ${logData.vehicleNumber}`);
            doc.text(`Start Mileage: ${logData.startMileage}`);
            doc.text(`End Mileage: ${logData.endMileage}`);
            doc.text(`Mileage: ${logData.mileage}`);
            doc.text(`Date: ${logData.date}`);
            doc.text(`Supervisor: ${logData.supervisor}`);
            doc.text('Activities:');
            logData.activities.forEach((activity, index) => {
                doc.text(`${index + 1}. ${activity.event} at ${new Date(activity.timestamp).toLocaleString()}`);
            });

            doc.end();
            const email = req.user.email; // Get badge number from the user session

            // Send email with the PDF attachment
            const mailOptions = {
                from: 'tob@status.rdpfister.com',
                to: email, // Printer or recipient email address
                subject: 'Tour Log PDF',
                text: 'Attached is the PDF for the completed tour log.',
                attachments: [
                    {
                        filename: filename,
                        path: filepath
                    }
                ]
            };

            transporter.sendMail(mailOptions, (emailError, info) => {
                if (emailError) {
                    console.error('Error sending email:', emailError);
                    return res.status(500).send('Error sending email');
                }
                console.log('Email sent:', info.response);
                res.send('Tour ended, PDF generated, and email sent successfully');
            });
        });
    });
});





// Add a new user
app.post('/add-user', async (req, res) => {
    try {
        const { name, badgeNumber, email, role } = req.body;
        await db.collection('users').add({ name, badgeNumber, email, role });
        res.redirect('/supervisors');
    } catch (error) {
        console.error('Error adding user:', error);
        res.status(500).send('Error adding user');
    }
});


app.post('/edit-user', async (req, res) => {
    try {
        const { userId, name, badgeNumber, email, role } = req.body;
        await db.collection('users').doc(userId).update({ name, badgeNumber, email, role });
        res.redirect('/supervisors');
    } catch (error) {
        console.error('Error editing user:', error);
        res.status(500).send('Error editing user');
    }
});

app.post('/send-password-reset', async (req, res) => {
    const { email } = req.body;

    try {
        // Use the Firebase Admin SDK to send a password reset email
        await admin.auth().generatePasswordResetLink(email);
        
        // You can also use sendPasswordResetEmail if you'd like to send directly
        // await admin.auth().sendPasswordResetEmail(email);

        res.status(200).send('Password reset email sent.');
    } catch (error) {
        console.error('Error sending password reset email:', error);
        res.status(500).send('Error sending password reset email.');
    }
});


// Make a user a supervisor
app.post('/make-supervisor', async (req, res) => {
    const { userId } = req.body;
    try {
        await User.update({ isSupervisor: 'true' }, { where: { id: userId } });
        res.send('User promoted to supervisor');
    } catch (error) {
        res.status(500).send('Error promoting user');
    }
});


app.post('/delete-user', async (req, res) => {
    try {
        const { userId } = req.body;
        await db.collection('users').doc(userId).delete();
        res.send('User deleted');
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).send('Error deleting user');
    }
});

app.get('/user-tours/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const toursSnapshot = await db.collection('tours').where('badgeNumber', '==', userId).get();
        const tours = toursSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.render('user-tours', { tours });
    } catch (error) {
        console.error('Error fetching tours:', error);
        res.status(500).send('Error fetching tours');
    }
});


// Get user details
app.get('/get-user', async (req, res) => {
    const { id } = req.query;
    try {
        const user = await User.findByPk(id);
        if (user) {
            res.json(user);
        } else {
            res.status(404).send('User not found');
        }
    } catch (error) {
        res.status(500).send('Error fetching user details');
    }
});

// Edit tour details
app.get('/edit-tour', async (req, res) => {
    const { tourId } = req.query;
    try {
        const tour = await Tour.findByPk(tourId);
        if (tour) {
            res.render('edit-tour', { tour });
        } else {
            res.status(404).send('Tour not found');
        }
    } catch (error) {
        res.status(500).send('Error fetching tour details');
    }
});

// Update tour details
app.post('/update-tour', async (req, res) => {
    const { tourId, vehicleNumber, startMileage, activities } = req.body;
    try {
        await Tour.update({ vehicleNumber, startMileage, activities }, { where: { id: tourId } });
        res.redirect('/supervisors');
    } catch (error) {
        res.status(500).send('Error updating tour');
    }
});






// Start server
const PORT = process.env.PORT || 80;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
