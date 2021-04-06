const {ApolloServer, gql} = require('apollo-server')
const dotenv = require('dotenv');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const {MongoClient, ObjectID} = require('mongodb');
dotenv.config();

const { DB_URI, DB_NAME, JWT_SECRET } = process.env;

const getToken = (user) => jwt.sign({id: user._id}, JWT_SECRET, {expiresIn: "30 days"})
const getUserFromToken = async (token, db) => {
    if(!token) {return null;}
    const tokenData = jwt.verify(token, JWT_SECRET);
    if(!tokenData?.id) {return null;}
    return await db.collection('Users').findOne({_id: ObjectID(tokenData.id)})
}

const typeDefs = gql`

    type Query {
        myTaskLists: [TaskList!]!
    }

    type Mutation {
        signUp(input: SignUpInput): AuthUser!
        signIn(input: SignInInput): AuthUser!

        createTaskList(title: String!): TaskList!
        updateTaskList(id: ID!, title: String!) TaskList!
        deleteTaskList(id: ID!): Boolean!
        addUserToTask(taskListId: ID!, userId: ID!): TaskList
    
        createToDo(content: String!, taskList: ID!): ToDo!
        updateToDo(id: ID!, content: String, isCompleted: Boolean): ToDo!
        deleteToDo(id: ID!)
    }

    input SignInInput {
        email: String!
        password: String!
    }

    input SignUpInput {
        email: String!
        password: String!
        name: String!
        avatar: String
    }

    type AuthUser{
        user: User!
        token: String!
    }

    type User{
        id: ID!
        name: String!
        email: String!
        avatar: String
    }

    type TaskList {
        id: ID!
        createdAt: String!
        title: String!
        progress: Float!

        users: [User!]!
        todos: [ToDo!]!
    }

    type ToDo {
        id: ID!
        content: String!
        isCompleted: Boolean!

        taskList: TaskList!
    }
`;

const resolvers = {
    Query: {
        myTaskLists: async (_, __, {db, user}) => {
            if(!user) {throw new Error('Autherntication Error. Please sign in'); }
            return await db.collection('TaskList').find({ userIds: user._id}).toArray();
        },
    },
    Mutation: {
        signUp: async (_, { input }, { db }) => {
            const hashedPassword = bcrypt.hashSync(input.password);
            const newUser = {
                ...input,
                password: hashedPassword
            }
            //save to DB
            const result = await db.collection('Users').insertOne(newUser);
            const user = result.ops[0];
            return {
                user,
                token: getToken(user)
            }
        },
        signIn: async (_, { input }, { db }) => {
            const user = await db.collection('Users').findOne({email: input.email});
            const isPasswordCorrect = user && bcrypt.compare(input.password, user.password);
            if(!user || !isPasswordCorrect){
                throw new Error('Invalid Credentials')
            }

            return {
                user,
                token: getToken(user)
            }
        },

        //TaskList CRUDs

        createTaskList: async(_, {title}, {db, user}) => {
            if(!user) {throw new error('Authenication Required. Please Sign In.')}

            const newTasksList = {
                title,
                createdAt: new Date().toISOString(),
                userIds: [user._id]
            }

            const result = await db.collection('TaskList').insertOne(newTasksList);
            console.log(result.ops[0]);
            return result.ops[0];
        },
        updateTaskList: async(_, {id, title}, {db, user}) => {
            if(!user) {throw new error('Authenication Required. Please Sign In.')}

            await db.collection('TaskList').updateOne({_id: ObjectID(id)}, {$set: {title: title}})
            
            return await db.collection('TaskList').findOne({_id: ObjectID(id)})
        },
        deleteTaskList: async(_, {id}, {db, user}) => {
            if(!user) {throw new Error('Authentication Required. Please Sign In')}

            await db.collection('TaskList').remove({_id: id}, {justOne: true});
            return true;
        },
        addUserToTask: async (_, {taskListId, userId}, {db, user}) => {
            if(!user) {throw new Error("Authentication Required. Please Sign in")}
            
            const taskList = await db.collection('TaskList').findOne({_id: ObjectID(taskListId)});
            if(!taskList){return null}

            if(taskList.userIds.find((dbId) => dbId.toString() === userId.toString())){
                return taskList;
            }

            await db.collection('TaskList').updateOne({_id: ObjectID(taskListId)}, {
                $push: {
                    userIds: ObjectID(userId)
                }
            })

            taskList.userIds.push(ObjectID(userId));
            return taskList;
            // const taskList = await db.collection('TaskList').findOneAndUpdate({_id: ObjectID(taskListId)}, {
            //     $set: {
            //         userIds: [...userIds, userId]
            //     }
            // });
        },

        //Todo CRUDs
        createToDo: async(_, { content, taskListId }, { db, user }) => {
            if (!user) { throw new Error('Authentication Error. Please sign in'); }
            const newToDo = {
              content, 
              taskListId: ObjectID(taskListId),
              isCompleted: false,
            }
            const result = await db.collection('ToDo').insert(newToDo);
            return result.ops[0];
          },
      
        updateToDo: async(_, data, { db, user }) => {
            if (!user) { throw new Error('Authentication Error. Please sign in'); }
      
            const result = await db.collection('ToDo')
                                  .updateOne({
                                    _id: ObjectID(data.id)
                                  }, {
                                    $set: data
                                  })
            
            return await db.collection('ToDo').findOne({ _id: ObjectID(data.id) });
          },
      
        deleteToDo: async(_, { id }, { db, user }) => {
            if (!user) { throw new Error('Authentication Error. Please sign in'); }
            
            // TODO only collaborators of this task list should be able to delete
            await db.collection('ToDo').removeOne({ _id: ObjectID(id) });
      
            return true;
        },
    },
    User: {
        id: ({_id}) => _id || id
    },
    TaskList: {
        id: ({_id, id}) => _id || id,
        progress: () => 0,
        users: async ({ userIds }, _, { db }) => Promise.all(
            userIds.map((userId) => (
              db.collection('Users').findOne({ _id: userId}))
            )
        ),
        todos: async ({_id}, _, {db}) => (
            await db.collection("ToDo").find({taskListId: ObjectID(_id)}).toArray()
        ),
    },
    ToDo: {
        id: ({_id, id}) => _id || id,
        taskList: async ({taskListId}, _, { db }) => await db.collection('TaskList').findOne({_id: ObjectID(taskListId)})
    }
};
  
const start = async () => {
    const client = new MongoClient(DB_URI, { useNewUrlParser: true, useUnifiedTopology: true });
    await client.connect();
    const db = client.db(DB_NAME);

    const server = new ApolloServer({ 
        typeDefs,
        resolvers,
        context: async ({req}) => {
            const user = await getUserFromToken(req.headers.authorization, db);
            return {
                db,
                user
            }
        }
    });
    server.listen().then(({ url }) => {
        console.log(`🚀  Server ready at ${url}`);
    });
} 

start();