import {
  APIGatewayProxyHandler,
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
} from 'aws-lambda';
import 'source-map-support/register';
import * as AWS from 'aws-sdk';
import * as AWSXRay from 'aws-xray-sdk';
const XAWS = AWSXRay.captureAWS(AWS);

const docClient = new XAWS.DynamoDB.DocumentClient();

const connectionsTable = process.env.CONNECTIONS_TABLE;
const stage = process.env.STAGE;
const apiId = process.env.API_ID

export const handler: APIGatewayProxyHandler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  console.log("req", event);
  const domain = event.requestContext.domainName;
  const stages = event.requestContext.stage;
  const connectionId = event.requestContext.connectionId;
  console.log({domain, stages, connectionId});
  const apigwManagementApi = new AWS.ApiGatewayManagementApi({
    apiVersion: '2018-11-29',
    endpoint:
      `${apiId}.execute-api.us-east-2.amazonaws.com/${stage}`
  });

  let connectionData;

  try {
    connectionData = await docClient
      .scan({ TableName: connectionsTable })
      .promise();
  } catch (e) {
    return { statusCode: 500, body: e.stack };
  }

  console.log("connectionData", connectionData);
  
  const postData = JSON.parse(event.body).data;
  console.log("postData", postData);
  
  const sendTo = JSON.parse(event.body).destination;
  console.log("sendTo", sendTo);

  const message = JSON.parse(event.body).message;
  console.log("message", message);


  try {
    await apigwManagementApi
      .postToConnection({ ConnectionId: sendTo, Data: message })
      .promise();
  } catch (e) {
    if (e.statusCode === 410) {
      console.log(`Found stale connection, deleting ${connectionId}`);
      await docClient
        .delete({ TableName: connectionsTable, Key: { connectionId } })
        .promise();
    } else {
      throw e;
    }
  }



  const postCalls = connectionData.Items.map(async ({ id }) => {
    try {
      console.log("id", id);
      await apigwManagementApi
        .postToConnection({ ConnectionId: id, Data: postData })
        .promise();
    } catch (e) {
      if (e.statusCode === 410) {
        console.log(`Found stale connection, deleting ${id}`);
        await docClient
          .delete({ TableName: connectionsTable, Key: { id } })
          .promise();
      } else {
        throw e;
      }
    }
  });

  try {
    console.log("postCalls");
    await Promise.all(postCalls);
  } catch (e) {
    return { statusCode: 500, body: e.stack };
  }

  return { statusCode: 200, body: 'Data sent.' };
};


// const sendMessageToClient = (url, connectionId, payload) =>
//   new Promise((resolve, reject) => {
//     const apigatewaymanagementapi = new AWS.ApiGatewayManagementApi({
//       apiVersion: '2018-11-29',
//       endpoint: url,
//     });
//     apigatewaymanagementapi.postToConnection(
//       {
//         ConnectionId: connectionId, // connectionId of the receiving ws-client
//         Data: JSON.stringify(payload),
//       },
//       (err, data) => {
//         if (err) {
//           console.log('err is', err);
//           reject(err);
//         }
//         resolve(data);
//       }
//     );
//   });

// module.exports.defaultHandler = async (event, context) => {
//   const domain = event.requestContext.domainName;
//   const stage = event.requestContext.stage;
//   const connectionId = event.requestContext.connectionId;
//   const callbackUrlForAWS = util.format(util.format('https://%s/%s', domain, stage)); //construct the needed url
//   await sendMessageToClient(callbackUrlForAWS, connectionId, event);

//   return {
//     statusCode: 200,
//   };
// };