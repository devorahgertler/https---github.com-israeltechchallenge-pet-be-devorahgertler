const express = require('express');
const app = express();
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const S = require('fluent-json-schema');
const AJV = require('ajv').default;
const addFormats = require("ajv-formats");
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

app.use(express.json());
app.use(require('cors')());

const pool = new Pool({
    user: 'devorahgertler',
    host: 'ep-patient-queen-a2t84upj.eu-central-1.aws.neon.tech',
    database: 'Pet Adoption',
    password: 'AKfLecr0o9Um',
    allowExitOnIdle: false,
    ssl: true
})

app.get('/', (req, res) => {
    res.send('Pet Adoption server is running')
});

const userSchema = S.object()
    .id('http://foo/user')
    .title('Users Schema')
    .description('Users')
    .prop('firstname', S.string().maxLength(100).required())
    .prop('lastname', S.string().maxLength(100).required())
    .prop('email', S.string().format('email').required())
    .prop('phone', S.string().pattern('^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$').required())
    .prop('password', S.string().pattern('^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9])(?=.*?[#?!@$ %^&*-]).{8,}$').required())

app.post('/signup', async (req, res) => {
    req.validate = (schema) => {
        const ajv = new AJV({ allErrors: true });
        addFormats(ajv);
        const validate = ajv.compile(schema.valueOf());
        const valid = validate(req.body);
        if (!valid) {
            res.status(403).send({ errors: validate.errors });
            return false;
        }
        return true;
    }
    const isValidated = await req.validate(userSchema)
    const hashedPassword = await bcrypt.hash(req.body.password, 10);
    if (isValidated && req.body.password === req.body.confirmedPassword) {
        try {
            const userId = uuidv4()
            const response = await pool.query(`INSERT INTO users (user_id, first_name, last_name, email, phone, password_hashed) VALUES('${userId}', '${req.body.firstname}', '${req.body.lastname}', '${req.body.email}', '${req.body.phone}', '${hashedPassword}')`)
            const token = jwt.sign({ email: req.body.email }, req.body.password, { expiresIn: 60 * 60 })
            res.status(200).send({ firstname: req.body.firstname, lastname: req.body.lastname, phone: req.body.phone, email: req.body.email, password: req.body.password, token })
        } catch (err) {
            res.send(err)
        }
    }
})

app.post('/login', async (req, res) => {
    try {
        const user = await pool.query(`SELECT * FROM users WHERE email = '${req.body.email}'`)
        if (user.rows.length === 1) {
            const isValidPassword = await bcrypt.compare(req.body.password, user.rows[0].password_hashed)
            if (!isValidPassword) {
                res.status(401).send({ error: 'Invalid password' });
            }
            else {
                const token = jwt.sign({ email: req.body.email }, req.body.password, { expiresIn: 60 * 60 })
                res.status(200).send({ firstname: user.rows[0].first_name, lastname: user.rows[0].last_name, phone: user.rows[0].phone, email: user.rows[0].email, password: req.body.password, isAdmin: user.rows[0].isadmin, token })
            }
        }
        else if (user.rows.length === 0) {
            res.status(401).send({ error: 'The email you entered is not registered.' });
        }
    }
    catch (err) {
        console.log(err)
    }
});

// const petsSchema = S.object()
//     .id('http://foo/pets')
//     .title('Pets Schema')
//     .description('Pets')
//     .prop('name', S.string().maxLength(100).required())
//     .prop('lastname', S.string().maxLength(100).required())
//     .prop('email', S.string().format('email').required())
//     .prop('phone', S.string().pattern('^[\+]?[(]?[0-9]{3}[)]?[-\s\.]?[0-9]{3}[-\s\.]?[0-9]{4,6}$').required())
//     .prop('password', S.string().pattern('^(?=.*?[A-Z])(?=.*?[a-z])(?=.*?[0-9])(?=.*?[#?!@$ %^&*-]).{8,}$').required())

app.listen(3001, () => {
    console.log('express is running');
})