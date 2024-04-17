const express = require('express');
const app = express();
const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
const S = require('fluent-json-schema');
const AJV = require('ajv').default;
const addFormats = require("ajv-formats");
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');

require('dotenv').config();

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '25mb' }));
app.use(require('cors')({ credentials: true, origin: 'http://localhost:3000' }));

const pool = new Pool({
    user: 'devorahgertler',
    host: 'ep-patient-queen-a2t84upj.eu-central-1.aws.neon.tech',
    database: 'Pet Adoption',
    password: 'AKfLecr0o9Um',
    allowExitOnIdle: false,
    ssl: true
})

const authenticate = async (req, res, next) => {
    const token = req.headers.authorization.replace('Bearer ', '');
    const password = process.env.PASSWORD
    jwt.verify(token, password, (err, decoded) => {
        if (err) {
            res.status(401).send({ message: 'Must authenticate' });
            return;
        }
        req.decoded = decoded
        next();
    })
}

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
    .prop('bio', S.string().maxLength(500))


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
            process.env['PASSWORD'] = req.body.password
            await pool.query(`INSERT INTO users (user_id, first_name, last_name, email, phone, password_hashed) VALUES('${userId}', '${req.body.firstname}', '${req.body.lastname}', '${req.body.email}', '${req.body.phone}', '${hashedPassword}')`)
            const newUser = await pool.query(`SELECT * FROM users WHERE user_id = '${userId}'`)
            const token = jwt.sign({ id: newUser.rows[0].user_id, email: newUser.rows[0].email, isAdmin: newUser.rows[0].isadmin }, req.body.password, { expiresIn: '1h' })
            res.status(200).send({ token })
        } catch (err) {
            console.log(err)
            res.send(err)
        }
    }
})

app.post('/login', async (req, res) => {
    try {
        const user = await pool.query(`SELECT * FROM users WHERE email = '${req.body.email}'`)
        if (user.rows.length === 1) {
            const userFound = user.rows[0]
            const isValidPassword = await bcrypt.compare(req.body.password, userFound.password_hashed)
            if (!isValidPassword) {
                res.status(401).send({ error: 'Invalid password' });
            }
            else {
                const token = jwt.sign({ id: userFound.user_id, email: userFound.email, isAdmin: userFound.isadmin }, req.body.password, { expiresIn: '1h' })
                process.env['PASSWORD'] = req.body.password
                res.status(200).send({ token })
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

app.get('/users/:id', async (req, res) => {
    try {
        const { id } = req.params
        const user = await pool.query(`SELECT * FROM users WHERE user_id = '${id}'`)
        res.status(200).send(user.rows[0])
    } catch (err) {
        console.log(err)
    }
})

app.put('/users/:id', authenticate, async (req, res) => {
    const { id } = req.params

    let bioToUpdate;
    if (req.body.bio) {
        bioToUpdate = req.body.bio
    } else {
        bioToUpdate = ''
    }

    let passwordToUpdate;
    if (req.body.password) {
        passwordToUpdate = req.body.password
    } else {
        passwordToUpdate = process.env.PASSWORD
    }


    const updatedUser = {
        firstname: req.body.firstname,
        lastname: req.body.lastname,
        phone: req.body.phone,
        email: req.body.email,
        bio: bioToUpdate,
        password: passwordToUpdate
    }

    const hashedOldPassword = await bcrypt.hash(req.body.password, 10);
    const hashedNewPassword = await bcrypt.hash(passwordToUpdate, 10);

    const ajv = new AJV({ allErrors: true });
    addFormats(ajv)
    const validate = ajv.compile(userSchema.valueOf())
    const valid = validate(updatedUser)
    if (!valid) {
        console.log(validate.errors)
        res.status(400).send({ message: 'Could not update your profile. Please try again.' })
    }
    if (valid) {
        try {
            const { id } = req.params
            const email = await pool.query(`SELECT * FROM users WHERE email = '${req.body.email}' AND user_id != '${id}'`)
            const isValidPassword = await bcrypt.compare(req.body.oldPassword, hashedOldPassword)
            if (req.body.password && !isValidPassword) {
                res.status(400).send({ message: 'Original password is invalid' })
            } else if (email.rows.length > 0) {
                res.status(409).send({ message: 'Another account already exists with this email.' })
            } else if (req.body.password && req.body.password != req.body.confirmedNewPassword) {
                res.status(400).send({ message: 'Passwords must match' })
            } else {
                const user = await pool.query(`Update users SET first_name='${updatedUser.firstname}', last_name='${updatedUser.lastname}', phone='${updatedUser.phone}', email='${updatedUser.email}', bio='${updatedUser.bio}', password_hashed='${hashedNewPassword}' WHERE user_id='${id}'`)
                res.status(200).send({ message: 'User updated' })
            }
        } catch (err) {
            console.log(err)
            res.status(500).send({ message: "We're sorry, there was a problem with the server. Please try again later." })
        }
    }
})

const GENDER = {
    male: 'male',
    female: 'female'
}

const STATUS = {
    available: 'available',
    adopted: 'adopted',
    fostered: 'fostered'
}

cloudinary.config({
    cloud_name: 'dg9calr9u',
    api_key: '383358175488837',
    api_secret: 'OC10R5cYR_k7yp1_m06aKTJW3yg'
});

const petsSchema = S.object()
    .id('http://foo/pets')
    .title('Pets Schema')
    .description('Pets')
    .prop('name', S.string().maxLength(100).required())
    .prop('type', S.string().maxLength(100).required())
    .prop('breed', S.string().maxLength(100).required())
    .prop('height', S.number().required())
    .prop('weight', S.number().required())
    .prop('color', S.string().maxLength(100).required())
    .prop('gender', S.string(Object.values(GENDER)).required())
    .prop('status', S.string(Object.values(STATUS)).required())
    .prop('image', S.string().required())
    .prop('hypoallergenic', S.boolean().required())
    .prop('dietary_restrictions', S.array().items(S.string()).required())
    .prop('bio', S.string().maxLength(500).required())

app.post('/addpet', async (req, res) => {
    const userId = req.body.userId

    const newPet = {
        name: req.body.name,
        type: req.body.type,
        breed: req.body.breed,
        height: parseFloat(req.body.height),
        weight: parseFloat(req.body.weight),
        color: req.body.color,
        gender: req.body.gender,
        status: req.body.status,
        image: req.body.image,
        hypoallergenic: req.body.isPetHypoallergenic,
        dietary_restrictions: req.body.petDietaryRestrictions,
        bio: req.body.petBio
    }

    const isAdmin = await pool.query(`SELECT * FROM users WHERE user_id = '${userId}'`)
    if (isAdmin.rows[0].isadmin === true) {
        const ajv = new AJV({ allErrors: true });
        addFormats(ajv)
        const validate = ajv.compile(petsSchema.valueOf())
        const valid = validate(newPet)
        if (!valid) console.log(validate.errors)
        if (valid) {
            try {
                const petId = uuidv4()
                const result = await cloudinary.uploader.upload(newPet.image)
                const fileUrl = result.secure_url;
                const addPet = await pool.query(`INSERT INTO pets ("name", id, "type", breed, height, weight, color, gender, status, image, hypoallergenic, bio, dietary_restrictions) VALUES ('${newPet.name}', '${petId}', '${newPet.type}', '${newPet.breed}', ${newPet.height}, ${newPet.weight}, '${newPet.color}', '${newPet.gender}', '${newPet.status}', '${fileUrl}', ${newPet.hypoallergenic}, '${newPet.bio}', '{${newPet.dietary_restrictions}}')`)
                res.status(200).send({ message: 'Thank you! Your pet has been added.' })
            }
            catch (err) {
                console.log(err)
                res.status(500).send("We're sorry, there was a problem adding your pet. Please try again later.")
            }
        }
    }
    else {
        res.status(403).send({ message: 'You must be an admin to view all users' })
    }
});

app.get('/searchtype/:type', async (req, res) => {
    try {
        const { type } = req.params
        const getPets = await pool.query(`SELECT * FROM pets WHERE type ILIKE '%${type}%'`)
        res.status(200).send(getPets.rows)
    } catch (err) {
        console.log(err)
    }
})

app.get('/searchother', async (req, res) => {
    try {
        const getPets = await pool.query(`SELECT * FROM pets WHERE type NOT ILIKE '%dog%' AND type NOT ILIKE '%cat%' AND type NOT ILIKE '%bird%'`)
        res.status(200).send(getPets.rows)
    } catch (err) {
        console.log(err)
    }
})

app.post('/search', async (req, res) => {
    try {
        const { typeParams, statusParams, sizeParams, genderParams } = req.body
        let updatedTypeParams = ''
        let updatedStatusParams = ''
        let updatedSizeParams = ''
        let updatedGenderParams = ''
        if (typeParams.length > 0) {
            const typeParamsString = typeParams.toString()
            updatedTypeParams = ` (${typeParamsString.replaceAll(',', ' OR ')})`
        }
        if (typeParams.length === 0 && statusParams.length > 0) {
            const statusParamsString = statusParams.toString()
            updatedStatusParams = ` (${statusParamsString.replaceAll(',', ' OR ')})`
        }
        if (typeParams.length > 0 && statusParams.length > 0) {
            const statusParamsString = statusParams.toString()
            updatedStatusParams = ` AND (${statusParamsString.replaceAll(',', ' OR ')})`
        }
        if (typeParams.length === 0 && statusParams.length === 0 && sizeParams.length > 0) {
            const sizeParamsString = sizeParams.toString()
            updatedSizeParams = ` (${sizeParamsString.replaceAll(',', ' OR ')})`
        }
        if ((typeParams.length > 0 || statusParams.length > 0) && sizeParams.length > 0) {
            const sizeParamsString = sizeParams.toString()
            updatedSizeParams = ` AND (${sizeParamsString.replaceAll(',', ' OR ')})`
        }
        if (typeParams.length === 0 && statusParams.length === 0 && sizeParams.length === 0) {
            const genderParamsString = genderParams.toString()
            updatedGenderParams = ` (${genderParamsString.replaceAll(',', ' OR ')})`
        }
        if ((typeParams.length > 0 || statusParams.length > 0 || sizeParams.length > 0) && genderParams.length > 0) {
            const genderParamsString = genderParams.toString()
            updatedGenderParams = ` AND (${genderParamsString.replaceAll(',', ' OR ')})`
        }
        const searchedPets = await pool.query(`SELECT * FROM pets WHERE${updatedTypeParams}${updatedStatusParams}${updatedSizeParams}${updatedGenderParams}`)
        res.status(200).send(searchedPets.rows)
    } catch (err) {
        console.log(err)
    }
})

app.post('/opensearch', async (req, res) => {
    try {
        const { openEndedSearch } = req.body
        const searchedPets = await pool.query(`SELECT * FROM pets WHERE name ILIKE '%${openEndedSearch}%' OR type ILIKE '%${openEndedSearch}%' OR breed ILIKE '%${openEndedSearch}%' OR bio ILIKE '%${openEndedSearch}%'`)
        if (searchedPets.rows.length > 0) {
            res.status(200).send(searchedPets.rows)
        }
        else {
            res.status(400).send({ message: "We're sorry. There are no pets to display that match your criteria." })
        }
    } catch (err) {
        res.status(500).send({ message: "Internal server error" })
    }
})

app.get('/petsbyid/:id', async (req, res) => {
    try {
        const { id } = req.params
        const getPet = await pool.query(`SELECT * FROM pets WHERE id = '${id}'`)
        res.status(200).send(getPet.rows)
    } catch (err) {
        console.log(err)
    }
})

app.get('/pets', async (req, res) => {
    try {
        const allPets = await pool.query(`SELECT * FROM pets`)
        res.status(200).send(allPets.rows)
    } catch (err) {
        res.status(500).send("We're sorry, we couldn't find any pets. Please try again later.")
    }
})

app.get('/ownedpets/:id', async (req, res) => {
    try {
        const { id } = req.params
        const ownedPets = await pool.query(`SELECT * from pets WHERE ownerid = '${id}'`)
        res.status(200).send(ownedPets.rows)
    } catch (err) {
        console.log(err)
    }
})

app.get('/savedpets/:id', async (req, res) => {
    try {
        const { id } = req.params
        const savedPets = await pool.query(`SELECT * from pets WHERE '${id}' = ANY(saved_by)`)
        res.status(200).send(savedPets.rows)
    } catch (err) {
        console.log(err)
    }
})

app.put('/pets/:id', async (req, res) => {
    const { userId } = req.body
    const { id } = req.body
    const isAdmin = await pool.query(`SELECT * FROM users WHERE user_id = '${userId}'`)
    if (isAdmin.rows[0].isadmin === true) {
        try {

            const editedPet = {
                name: req.body.name,
                type: req.body.type,
                breed: req.body.breed,
                height: parseFloat(req.body.height),
                weight: parseFloat(req.body.weight),
                color: req.body.color,
                gender: req.body.gender,
                status: req.body.status,
                image: req.body.image,
                hypoallergenic: req.body.isPetHypoallergenic,
                dietary_restrictions: req.body.petDietaryRestrictions,
                bio: req.body.petBio
            }

            const ajv = new AJV({ allErrors: true });
            addFormats(ajv)
            const validate = ajv.compile(petsSchema.valueOf())
            const valid = validate(editedPet)
            if (!valid) console.log(validate.errors)
            if (valid) {
                const editPet = await pool.query(`UPDATE pets SET "name"='${editedPet.name}', "type"='${editedPet.type}', breed='${editedPet.breed}', height=${editedPet.height}, weight=${editedPet.weight}, color='${editedPet.color}', gender='${editedPet.gender}', status='${editedPet.status}', image='${editedPet.image}', hypoallergenic=${editedPet.hypoallergenic}, bio='${editedPet.bio}', dietary_restrictions='{${editedPet.dietary_restrictions}}' WHERE id='${req.body.id}'`)
                res.status(200).send(editPet)
            }
        } catch (err) {
            console.log(err)
        }
    } else {
        res.status(403).send({ message: 'You must be an admin to edit pet information' })
    }
})

app.put('/adopt', authenticate, async (req, res) => {
    try {
        const { petId, userId } = req.body
        const newlyAdoptedPet = await pool.query(`SELECT * FROM pets WHERE id = '${petId}'`)
        const user = await pool.query(`SELECT * FROM users WHERE user_id = '${userId}'`)
        await pool.query(`UPDATE users SET adopted_pets = array_append(adopted_pets, '${newlyAdoptedPet.rows[0].id}') WHERE user_id = '${user.rows[0].user_id}'`)
        await pool.query(`UPDATE pets SET ownerid = '${userId}' WHERE id = '${petId}'`)
        await pool.query(`UPDATE pets SET status = 'Adopted' WHERE id = '${petId}'`)
        res.status(200).send({ message: `Thank you for agreeing to adopt '${newlyAdoptedPet.rows[0].name}'! An admin will contact you shortly to arrange the details.` })
    } catch (err) {
        console.log(err)
        res.status(500).send({ Message: 'Internal server error. Please try again later.' })
    }
})

app.put('/foster', authenticate, async (req, res) => {
    try {
        const { petId, userId } = req.body
        const newlyFosteredPet = await pool.query(`SELECT * FROM pets WHERE id = '${petId}'`)
        const user = await pool.query(`SELECT * FROM users WHERE user_id = '${userId}'`)
        await pool.query(`UPDATE users SET fostered_pets = array_append(fostered_pets, '${newlyFosteredPet.rows[0].id}') WHERE user_id = '${user.rows[0].user_id}'`)
        await pool.query(`UPDATE pets SET ownerid = '${userId}' WHERE id = '${petId}'`)
        await pool.query(`UPDATE pets SET status = 'Fostered' WHERE id = '${petId}'`)
        res.status(200).send({ message: `Thank you for agreeing to foster '${newlyFosteredPet.rows[0].name}'! An admin will contact you shortly to arrange the details.` })
    } catch (err) {
        console.log(err)
        res.status(500).send({ Message: 'Internal server error. Please try again later.' })
    }
})

app.put('/return', authenticate, async (req, res) => {
    try {
        const { petId, userId } = req.body
        const petToReturn = await pool.query(`SELECT * FROM pets WHERE id = '${petId}'`)
        const user = await pool.query(`SELECT * FROM users WHERE user_id = '${userId}'`)
        if (user.rows[0].adopted_pets.includes(petId)) {
            await pool.query(`UPDATE users SET adopted_pets = array_remove(adopted_pets, '${petToReturn.rows[0].id}') WHERE user_id = '${user.rows[0].user_id}'`)
        } else if (user.rows[0].fostered_pets.includes(petId)) {
            await pool.query(`UPDATE users SET fostered_pets = array_remove(fostered_pets, '${petToReturn.rows[0].id}') WHERE user_id = '${user.rows[0].user_id}'`)
        }
        await pool.query(`UPDATE pets SET status = 'Available' WHERE id = '${petId}'`)
        await pool.query(`UPDATE pets SET ownerid = NULL WHERE id = '${petToReturn.rows[0].id}'`)
        res.status(200).send({ message: `Thank you for the time you spent taking care of '${petToReturn.rows[0].name}'! An admin will contact you shortly to arrange the details.` })
    } catch (err) {
        console.log(err)
        res.status(500).send({ Message: 'Internal server error. Please try again later.' })
    }
})

app.put('/save', authenticate, async (req, res) => {
    try {
        const { petId, userId } = req.body
        const newlySavedPet = await pool.query(`SELECT * FROM pets WHERE id = '${petId}'`)
        const user = await pool.query(`SELECT * FROM users WHERE user_id = '${userId}'`)
        await pool.query(`UPDATE users SET saved_pets = array_append(saved_pets, '${newlySavedPet.rows[0].id}') WHERE user_id = '${user.rows[0].user_id}'`)
        await pool.query(`UPDATE pets SET saved_by = array_append(saved_by, '${user.rows[0].user_id}') WHERE id = '${newlySavedPet.rows[0].id}'`)
        res.status(200).send({ message: `Pet saved!` })
    } catch (err) {
        console.log(err)
        res.status(500).send({ Message: 'Internal server error. Please try again later.' })
    }
})

app.put('/unsave', authenticate, async (req, res) => {
    try {
        const { petId, userId } = req.body
        const petToRemove = await pool.query(`SELECT * FROM pets WHERE id = '${petId}'`)
        const user = await pool.query(`SELECT * FROM users WHERE user_id = '${userId}'`)
        await pool.query(`UPDATE users SET saved_pets = array_remove(saved_pets, '${petToRemove.rows[0].id}') WHERE user_id = '${user.rows[0].user_id}'`)
        await pool.query(`UPDATE pets SET saved_by = array_remove(saved_by, '${user.rows[0].user_id}') WHERE id = '${petId}'`)
        res.status(200).send({ message: `Pet unsaved` })
    } catch (err) {
        console.log(err)
        res.status(500).send({ message: 'Internal server error. Please try again later.' })
    }
})

app.post('/allusers', authenticate, async (req, res) => {
    const { userId } = req.body
    const user = await pool.query(`SELECT * FROM users WHERE user_id = '${userId}'`)
    if (user.rows[0].isadmin === true) {
        try {
            const allUsers = await pool.query(`SELECT * FROM users`)
            res.status(200).send(allUsers.rows)
        }
        catch (err) {
            console.log(err)
        }
    } else {
        res.status(403).send({ message: 'You must be an admin to view all users' })
    }
})

app.post('/allpets', authenticate, async (req, res) => {
    const { userId } = req.body
    const user = await pool.query(`SELECT * FROM users WHERE user_id = '${userId}'`)
    if (user.rows[0].isadmin === true) {
        try {
            const allPets = await pool.query(`SELECT * FROM pets`)
            res.status(200).send(allPets.rows)
        }
        catch (err) {
            console.log(err)
        }
    } else {
        res.status(403).send({ message: 'You must be an admin to view all pets' })
    }
})

app.listen(3001, () => {
    console.log('express is running');
})