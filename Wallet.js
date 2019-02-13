var http = require('http');
var url = require('url');
const fs = require("fs");
const Web3 = require('web3');
const Tx = require('ethereumjs-tx');

const MY_ADDRESS = /*'0x04FEB49ffc9645bF66CDC3191EC236b8647278B4'; //*/'0xC14BbA1b6CC582BBB6B554a5c0821C619CFD42c4';
const MY_PRIVATE_KEY = /*Buffer.from('af45f5d02f04e2c52b138b48f3513bd9000280e3b3383911aeb05d9e5dd07861', 'hex'); //*/Buffer.from('099e8dc1316d838865648e3df3698e7a2037b6c81f270cc075a415b4a8ca6270', 'hex');
const MAINNET_URL = "ws://localhost:8546";
const TOKEN_SOURCE_FILE = "./bin/BridgedToken.json";

var _web3_main = new Web3(new Web3.providers.WebsocketProvider(MAINNET_URL));
var _web3_side = new Web3(new Web3.providers.WebsocketProvider('ws://localhost:8548'));
var _token_main = '0xa2b8e36e28f704da0aa9fb966b8fd88754248f2e';
var _token_side = '0x9a9e5a71efd94e446a0b2e78a5ae5da4debc176a';

let source = fs.readFileSync(TOKEN_SOURCE_FILE);
const token_contract = JSON.parse(source);

function displayPage(filename, res) {
    fs.readFile(filename, function(err, data) {
        if (err) {
          res.writeHead(404, {'Content-Type': 'text/html'});
          return res.end("404 Not Found");
        }
        res.writeHead(200, {'Content-Type': 'text/html'});
        res.write(data);
        return res.end();
    });
}

function returnJson(json, res) {
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.write(JSON.stringify(json));
    return res.end();
}

async function sendRawTx(provider, abiData, account, key, dest) {
    let nonce = await provider.eth.getTransactionCount(account);
    var rawTx = {
        nonce: nonce,
        from: account,
        to: dest,
        data: abiData,
        gasPrice: '0x09184e72a000',
        gasLimit: '0x5AA710',
      };
    const tx = new Tx(rawTx);
    tx.sign(key);
    return await provider.eth.sendSignedTransaction('0x' + tx.serialize().toString('hex'))
}

function selectNetwork(net, err) {
    var selectedProvider;
    var selectedToken;
    switch (net) {
        case "main":
            selectedProvider = _web3_main;
            selectedToken = _token_main;
            break;
        case "side":
            selectedProvider = _web3_side;
            selectedToken = _token_side;
            break;
        default:
            err();
            break;
    }
    return { provider: selectedProvider, token: selectedToken };
}

function getAccount(req, res) {
    var account = {
        address: MY_ADDRESS
    }
    return returnJson(account, res);
}

async function getTokenBalance(web3_provider, token, account, key) {
    let token_dest = web3_provider.eth.Contract(token_contract.abi, token);
    let balance = await token_dest.methods.balanceOf(account).call({from: account});
    return balance;
}

async function getBalance(req, res) {
    try {
        var balance = {};
        var params = selectNetwork(req.query.net, () => {
            balance.err = "Invalid network specified";
        });

        if (params.provider)
        {
            balance.net = req.query.net;
            balance.amount = await getTokenBalance(params.provider, params.token, MY_ADDRESS, MY_PRIVATE_KEY);
        }
        return returnJson(balance, res);
    } catch (error) {
        console.log(error);
        var balance = {
            err: error.toString()
        };
        return returnJson(balance, res)
    }
}

async function transferTokens(req, res) {
    try {
        let token_dest = _web3_side.eth.Contract(token_contract.abi, _token_side);
        let abiData = token_dest.methods.transfer(req.query.to, req.query.amount).encodeABI();
        await sendRawTx(_web3_side, abiData, MY_ADDRESS, MY_PRIVATE_KEY, _token_side);
        return returnJson({}, res);
    } catch (error) {
        console.log(error);
        var balance = {
            err: error.toString()
        };
        return returnJson(balance, res)
    }
}

async function convertTokens(req, res) {
    try {
        var conversion = {};
        var params = selectNetwork(req.query.net, () => {
            conversion.err = "Invalid network specified";
            console.log(req.query.net);
        });
        if (params.provider) {
            let token_dest = params.provider.eth.Contract(token_contract.abi, params.token);
            let abiData = token_dest.methods.lock(req.query.amount).encodeABI();
            await sendRawTx(params.provider, abiData, MY_ADDRESS, MY_PRIVATE_KEY, params.token);
        }
        return returnJson(conversion, res);
    } catch (error) {
        console.log(error);
        var balance = {
            err: error.toString()
        };
        return returnJson(balance, res)
    }
}

function selectAction(req, res) {
    switch (req.pathname) {
        case "":
        case "/":
            return displayPage("./Wallet.html", res);
        case "/get_account":
            return getAccount(req, res);
        case "/get_balance":
            return getBalance(req, res);
        case "/transfer":
            return transferTokens(req, res);
        case "/convert":
            return convertTokens(req, res);
        default:
            return displayPage("." + req.pathname, res)
    }
}

console.log("Starting server...");
http.createServer(function (req, res) {
    var q = url.parse(req.url, true);
    return selectAction(q, res);
}).listen(8081);