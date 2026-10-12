const {verifySessionTokenDetails}=require('../services/sessionTokenService');
const {assertActiveSession}=require('../services/activeSessionsService');
const {getCurrentSession}=require('../services/authService');
async function requireFinancialSession(req,_res,next){
  try{
    const token=String(req.header('authorization')||'').match(/^Bearer\s+(.+)$/i)?.[1];
    const session=verifySessionTokenDetails(token);
    if(!session)throw Object.assign(new Error('Sesión inválida.'),{status:401});
    await assertActiveSession(session.sub,session.sid);
    const user=await getCurrentSession(session.sub);
    if(!['residente','inquilino'].includes(user.role))throw Object.assign(new Error('Acceso financiero restringido.'),{status:403});
    req.authUser={id:user.id,role:user.role};req.authSessionId=session.sid;next();
  }catch(error){next(error);}
}
module.exports={requireFinancialSession};
