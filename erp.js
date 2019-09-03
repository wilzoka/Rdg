const application = require('../../routes/application')
    , db = require('../../models')
    , moment = require('moment')
    ;

let main = {
    platform: require('../platform.js')
    , erp: {
        cadastro: {
            pessoa: {
                onsave: async function (obj, next) {
                    try {
                        let pessoatipo;
                        if (obj.view.name == "Cliente") {
                            obj.register.cliente = true;
                            pessoatipo = 'cliente';
                        } else if (obj.view.name == "Fornecedor") {
                            obj.register.fornecedor = true;
                            pessoatipo = 'fornecedor';
                        }
                        let saved = await next(obj);

                        if (saved.success) {
                            let pessoa = await db.getModel('cad_pessoa').findOne({ where: { id: saved.register.id } })
                            main.platform.notification.create([4], {
                                title: 'Novo ' + pessoatipo
                                , description: pessoa.fantasia
                                , link: '/v/' + pessoatipo + '/' + saved.register.id
                            });
                        }

                        db.sequelize.query("update cad_pessoa p set nomecompleto = coalesce(p.fantasia,'') || ' - ' || coalesce(p.bairro,'') || ' - ' || coalesce(p.logradouro,'') || ' - Nº ' || p.numero  || ' - ' || coalesce(p.complemento,'') where id = :idcliente;"
                            , {
                                type: db.sequelize.QueryTypes.UPDATE
                                , replacements: { idcliente: obj.register.id }
                            });

                    } catch (err) {
                        return application.fatal(obj.res, err);
                    }
                }
            }
        }
        , comercial: {
            venda: {
                onsave: async function (obj, next) {
                    try {

                        if (obj.register.id == 0) {
                            obj.register.idusuario = obj.req.user.id;
                        } else {
                            if (obj.register.digitado) {
                                return application.error(obj.res, { msg: 'Não é possível alterar uma venda concluída' });
                            }
                        }

                        function nextStep() {
                            obj._responseModifier = function (ret) {
                                delete ret['msg'];
                                delete ret['historyBack'];
                                return ret;
                            }
                            obj._cookies = [{ key: 'wizard-step', value: parseInt(obj.req.body['wizard-step']) + 1 }];
                        }
                        let neednotification = false;

                        switch (obj.req.body['wizard-step']) {
                            case '0'://Cliente
                                nextStep();
                                break;
                            case '1'://Produto
                                nextStep();
                                break;
                            case '2'://Retorno
                                nextStep();
                                break;
                            case '3'://Pagamento
                                if (!obj.register.digitado) {
                                    obj.register.digitado = true;
                                    neednotification = true;

                                    let somavenda = await db.sequelize.query(`select sum(vi.qtd * vi.valorunitario) as total from com_vendaitem vi where vi.idvenda = :idvenda`, { type: db.Sequelize.QueryTypes.SELECT, replacements: { idvenda: obj.register.id } });
                                    let totalvenda = parseFloat(somavenda[0]['total']) - parseFloat(obj.register.desconto || 0) + parseFloat(obj.register.acrescimo || 0);
                                    if (!obj.register.identregador) {
                                        return application.error(obj.res, { msg: `É obrigatório informar o entregador` })
                                    }
                                    let tipovenda = await db.getModel('com_tipovenda').findOne({ where: { id: obj.register.idtipovenda } });
                                    if (!tipovenda.idcategoria) {
                                        return application.error(obj.res, { msg: `Tipo de venda "${tipovenda.description}" sem categoria definida` })
                                    }
                                    let vendaformaspgto = await db.getModel('com_vendapagamento').findAll({ where: { idvenda: obj.register.id } });
                                    let formaspgto = await db.getModel('fin_formapgto').findAll({ where: { disp_venda: true } });
                                    let conta = await db.getModel('fin_usersconta').findOne({ where: { iduser: obj.register.identregador } })
                                    let valorestante = totalvenda
                                    if (vendaformaspgto.length > 0) {
                                        for (let i = 0; i < vendaformaspgto.length; i++) {
                                            let prazo = 0;
                                            let valortaxas = 0;
                                            let totalparcelas = 0;
                                            for (let j = 0; j < formaspgto.length; j++) {
                                                if (vendaformaspgto[i].idformapgto == formaspgto[j].id) {
                                                    if (formaspgto[j].formarecebimento == 'a Vista') {
                                                        let mov = await db.getModel('fin_mov').create({
                                                            datavcto: moment()
                                                            , idcategoria: tipovenda.idcategoria
                                                            , valor: parseFloat(vendaformaspgto[i].valor).toFixed(2)
                                                            , parcela: null
                                                            , quitado: true
                                                            , compensando: false
                                                            , idpessoa: obj.register.idcliente
                                                            , idvenda: obj.register.id
                                                            , detalhe: `Venda ID ${obj.register.id}`
                                                        })
                                                        let movparc = await db.getModel('fin_movparc').create({
                                                            datahora: moment()
                                                            , idmov: mov.id
                                                            , valor: parseFloat(vendaformaspgto[i].valor).toFixed(2)
                                                            , idformapgto: vendaformaspgto[i].idformapgto
                                                            , idconta: conta.idconta
                                                        })
                                                    } else if (formaspgto[j].formarecebimento == 'a Prazo') {
                                                        prazo += formaspgto[j].prazo ? formaspgto[j].prazo :
                                                            vendaformaspgto[i].vencimento ? moment(vendaformaspgto[i].vencimento, application.formatters.be.date_format).diff(moment(), 'd') + 1 : 7;
                                                        valortaxas += formaspgto[j].taxa != null ? parseFloat((parseFloat(vendaformaspgto[i].valor) * formaspgto[j].taxa) / 100) : 0;
                                                        totalparcelas += formaspgto[j].parcelas != null ? formaspgto[j].parcelas : 0;
                                                        let valorparcela = totalparcelas == 0 ? vendaformaspgto[i].valor : (vendaformaspgto[i].valor - valortaxas) / totalparcelas;
                                                        let datavenc = moment().add(prazo + 1, 'day');
                                                        if (totalparcelas > 1) {
                                                            for (let l = 0; l < totalparcelas; l++) {
                                                                let mov = await db.getModel('fin_mov').create({
                                                                    datavcto: datavenc
                                                                    , idcategoria: tipovenda.idcategoria
                                                                    , valor: parseFloat(valorparcela).toFixed(2)
                                                                    , parcela: totalparcelas == 0 ? null : (l + 1) + '/' + totalparcelas
                                                                    , quitado: false
                                                                    , compensando: false
                                                                    , idformapgto: vendaformaspgto[i].idformapgto
                                                                    , idpessoa: obj.register.idcliente
                                                                    , idvenda: obj.register.id
                                                                    , detalhe: `Venda ID ${obj.register.id}`
                                                                })
                                                                datavenc = datavenc.add(1, 'M');
                                                            }
                                                        } else {
                                                            let mov = await db.getModel('fin_mov').create({
                                                                datavcto: datavenc
                                                                , idcategoria: tipovenda.idcategoria
                                                                , valor: parseFloat(valorparcela).toFixed(2)
                                                                , parcela: totalparcelas == 0 ? null : (l + 1) + '/' + totalparcelas
                                                                , quitado: false
                                                                , compensando: false
                                                                , idformapgto: vendaformaspgto[i].idformapgto
                                                                , idpessoa: obj.register.idcliente
                                                                , idvenda: obj.register.id
                                                                , detalhe: `Venda ID ${obj.register.id}`
                                                            })
                                                        }
                                                    } else if (formaspgto[j].formarecebimento == 'Vale') {
                                                        let retorno = await main.erp.comercial.venda.f_atualizarValeColetado(formaspgto[j], obj.register);
                                                        if (!retorno) {
                                                            return application.error(obj.res, { msg: `Vale não cadastrado. Solicitar cadastro` });
                                                        }
                                                    }
                                                    valorestante -= vendaformaspgto[i].valor;
                                                }
                                            }
                                        }
                                        if (valorestante > 0) {
                                            let mov = await db.getModel('fin_mov').create({
                                                datavcto: moment().add(30, 'day')
                                                , idcategoria: tipovenda.idcategoria
                                                , valor: parseFloat(valorestante).toFixed(2)
                                                , quitado: false
                                                , compensando: false
                                                , idpessoa: obj.register.idcliente
                                                , idvenda: obj.register.id
                                                , detalhe: `Venda ID ${obj.register.id}`
                                            })
                                        }
                                    } else {
                                        let mov = await db.getModel('fin_mov').create({
                                            datavcto: moment().add(30, 'day')
                                            , idcategoria: tipovenda.idcategoria
                                            , valor: parseFloat(totalvenda).toFixed(2)
                                            , quitado: false
                                            , compensando: false
                                            , idpessoa: obj.register.idcliente
                                            , idvenda: obj.register.id
                                            , detalhe: `Venda ID ${obj.register.id}`
                                        })
                                    }

                                    let vendaitem = await db.getModel('com_vendaitem').findAll({ where: { idvenda: obj.register.id } });
                                    let vendaretorno = await db.getModel('com_vendaretorno').findAll({ where: { idvenda: obj.register.id } });

                                    for (let i = 0; i < vendaitem.length; i++) {
                                        db.getModel('est_mov').create({
                                            datahora: obj.register.datahora
                                            , iditem: vendaitem[i].iditem
                                            , quantidade: vendaitem[i].qtd
                                            , iduser: obj.register.identregador
                                            , tipo: 'Saída'
                                            , detalhes: `Venda ID ${obj.register.id}`
                                            , identificacao: `VENDA${obj.register.id}`
                                        });
                                    }

                                    for (let i = 0; i < vendaretorno.length; i++) {
                                        db.getModel('est_mov').create({
                                            datahora: obj.register.datahora
                                            , iditem: vendaretorno[i].item
                                            , quantidade: vendaretorno[i].quantidade
                                            , iduser: obj.register.identregador
                                            , tipo: 'Entrada'
                                            , detalhes: `Venda ID ${obj.register.id}`
                                            , identificacao: `VENDA${obj.register.id}`
                                        });
                                    }

                                    obj._responseModifier = function (ret) {
                                        ret['redirect'] = '/v/painel_do_vendedor';
                                        return ret;
                                    }
                                }
                                break;
                            default:
                                return application.error(obj.res, {});
                                break;
                        }
                        if (!obj.register.editado) {
                            obj.register.datahora = moment();
                            obj.register.identregador = obj.req.user.id;
                        }

                        let saved = await next(obj);

                        if (saved.success && saved.register.identregador && neednotification) {
                            let cliente = await db.getModel('cad_pessoa').findOne({ where: { id: saved.register.idcliente } })
                            main.platform.notification.create([4], {
                                title: 'Nova Venda'
                                , description: cliente.fantasia
                                , link: '/v/venda/' + saved.register.id
                            });
                        }
                    } catch (err) {
                        return application.fatal(obj.res, err);
                    }
                }
                , js_historicoCompras: async function (obj) {
                    try {
                        let historico = await db.sequelize.query(
                            `SELECT DISTINCT "com_venda"."id"
                                , "com_venda"."datahora"
                                , (SELECT COALESCE(STRING_AGG(item.descricao, ' + ' ),'')
                                    FROM com_vendaitem vi 
                                    LEFT JOIN "cad_item" AS "item" ON "vi"."iditem" = "item"."id" 
                                    WHERE vi.idvenda = com_venda.id) AS "item"																												
                                , (SELECT COALESCE(STRING_AGG(fin_pgto.descricao, ' + '),'')
                                    FROM "com_vendapagamento" AS "ven_pgto" 
                                    LEFT JOIN "fin_formapgto" AS "fin_pgto" ON "ven_pgto"."idformapgto" = "fin_pgto"."id" 
                                    WHERE ven_pgto.idvenda = com_venda.id) AS "pagamento"
                                , (SELECT COALESCE(TRUNC(SUM(vi.qtd * vi.valorunitario),2),0.00) 
                                    FROM com_vendaitem vi 
                                    WHERE vi.idvenda = com_venda.id) - COALESCE(com_venda.desconto, 0) + COALESCE(com_venda.acrescimo, 0)  AS "totalvenda"
                                , (SELECT COALESCE(TRUNC(SUM(valor),2),0.00) 
                                    FROM fin_mov 
                                    WHERE idvenda = com_venda.id and quitado = false and (compensado = false or compensado is null)) AS "totalpendente"
                            FROM "com_venda" 				AS "com_venda" 
                            LEFT JOIN "com_vendaitem"		AS "v_item"			ON "com_venda"."id" = "v_item"."idvenda"
                            WHERE com_venda.idcliente = :cliente
                            ORDER BY com_venda.datahora DESC
                            LIMIT 5`
                            , {
                                type: db.Sequelize.QueryTypes.SELECT
                                , replacements: {
                                    cliente: obj.data.idcliente
                                }
                            });

                        let body = `
                            <div id="tablebody" class="col-md-12" style="padding-bottom: 10px">
                                <h4 align="center"> Histórico de Compras </h4>
                                <table border="1" cellpadding="1" cellspacing="0" style="border-collapse:collapse; width:100%">
                                    <tr>
                                        <td style="text-align:center;"><strong>ID</strong></td>
                                        <td style="text-align:center;"><strong>Data</strong></td>
                                        <td style="text-align:center;"><strong>Item</strong></td>
                                        <td style="text-align:center;"><strong>Pgto</strong></td>
                                        <td style="text-align:center;"><strong>Total</strong></td>
                                        <td style="text-align:center;"><strong>Aberto</strong></td>
                                    </tr>
                                    `;
                        for (let i = 0; i < historico.length; i++) {
                            body += `
                            <tr>
                                <td style="text-align:center;">  ${historico[i].id}   </td>    
                                <td style="text-align:center;"> ${application.formatters.fe.date(historico[i].datahora)}   </td>
                                <td style="text-align:left;">  ${historico[i].item}   </td>
                                <td style="text-align:left;">  ${historico[i].pagamento}   </td>
                                <td style="text-align:center;">  ${historico[i].totalvenda}   </td>
                                <td style="text-align:center;">  ${historico[i].totalpendente}   </td>
                            </tr>
                            `;
                        }
                        body += `
                        </table>
                        </div>`;

                        return application.success(obj.res, { body });
                    } catch (err) {
                        return application.fatal(obj.res, err);
                    }
                }
                , e_cadastrarvales: async function (obj) {
                    try {

                        if (obj.req.method == 'GET') {

                            let vales = await db.getModel('fin_formapgto').findAll();
                            let itens = await db.getModel('cad_item').findAll();
                            let pessoas = await db.getModel('cad_pessoa').findAll();

                            let body = '';
                            body += application.components.html.date({
                                width: '4'
                                , label: 'Data*'
                                , name: 'data'
                                , value: moment().format(application.formatters.fe.date_format)
                            });
                            body += application.components.html.autocomplete({
                                width: '4'
                                , label: 'Vale*'
                                , name: 'idformapgto'
                                , model: 'fin_formapgto'
                                , attribute: 'descricao'
                                , where: `formarecebimento = 'Vale'`
                            });
                            body += application.components.html.autocomplete({
                                width: '4'
                                , label: 'Item*'
                                , name: 'iditem'
                                , model: 'cad_item'
                                , attribute: 'descricao'
                            });
                            body += application.components.html.autocomplete({
                                width: '4'
                                , label: 'Pessoa*'
                                , name: 'idpessoa'
                                , model: 'cad_pessoa'
                                , attribute: 'nome'
                            });
                            body += application.components.html.integer({
                                width: '4'
                                , label: 'Quantidade*'
                                , name: 'qtd'
                            });
                            body += application.components.html.decimal({
                                width: '4'
                                , label: 'Valor Entrega'
                                , name: 'valorentrega'
                                , precision: '2'
                            });

                            return application.success(obj.res, {
                                modal: {
                                    form: true
                                    , id: 'modalevt'
                                    , action: '/event/' + obj.event.id
                                    , title: obj.event.description
                                    , body: body
                                    , footer: '<button type="button" class="btn btn-default" data-dismiss="modal">Cancelar</button> <button type="submit" class="btn btn-primary">Cadastrar</button>'
                                }
                            });

                        } else {

                            let invalidfields = application.functions.getEmptyFields(obj.req.body, ['data', 'idformapgto', 'iditem', 'idpessoa', 'qtd']);
                            if (invalidfields.length > 0) {
                                return application.error(obj.res, { msg: application.message.invalidFields, invalidfields: invalidfields });
                            }

                            if (obj.req.body.qtd <= 0) {
                                return application.error(obj.res, { msg: 'A quantidade deve ser maior que 0', invalidfields: ['qtd'] });
                            }

                            for (let i = 0; i < obj.req.body.qtd; i++) {
                                let vale = await db.getModel('com_vale').create({
                                    data: application.formatters.be.date(obj.req.body.data)
                                    , idformapgto: obj.req.body.idformapgto
                                    , iditem: obj.req.body.iditem
                                    , recebido: false
                                    , coletado: false
                                    , idpessoa: typeof obj.req.body.idpessoa == 'undefined' ? null : obj.req.body.idpessoa
                                    , valorentrega: obj.req.body.valorentrega == '' ? null : application.formatters.be.decimal(obj.req.body.valorentrega)
                                });
                            }
                        }
                        return application.success(obj.res, { msg: application.message.success, reloadtables: true });
                    } catch (err) {
                        return application.fatal(obj.res, err);
                    }
                }
                , f_atualizarValeColetado: async function (obj, venda) {
                    try {

                        let item = await db.getModel('com_vendaitem').findOne({ where: { idvenda: venda.id } });

                        let vale = await db.sequelize.query(
                            `SELECT val.id, val.idformapgto, val.idpessoa, val.iditem
                            FROM com_vale val
                            LEFT JOIN com_vendapagamento vpag 	on val.id = vpag.idformapgto
                            LEFT JOIN com_venda ven 			on vpag.idvenda = ven.id
                            LEFT JOIN com_vendaitem vit 		on ven.id = vit.idvenda
                            WHERE val.iditem = :iditem
                                AND val.idformapgto = :idformapgto
                                AND val.idpessoa = :idpessoa
                                AND val.coletado = false
                            ORDER BY val.data
                            LIMIT 1`
                            , {
                                type: db.Sequelize.QueryTypes.SELECT
                                , replacements: {
                                    iditem: item.iditem
                                    , idformapgto: obj.id
                                    , idpessoa: venda.idcliente
                                }
                            });

                        let found = true;
                        if (vale[0] == null) {
                            found = false;
                        }
                        if (found) {
                            db.sequelize.query(
                                `UPDATE com_vale
                                SET coletado = true
                                WHERE id = :idvale`
                                , {
                                    type: db.sequelize.QueryTypes.UPDATE
                                    , replacements: {
                                        idvale: vale[0].id
                                    }
                                });

                            return true;
                        } else {
                            return false;
                        }
                    } catch (err) {
                        return application.fatal(obj.res, err);
                    }
                }
                , js_prevenda: async function (obj) {
                    try {
                        let prevendas = await db.sequelize.query(
                            `SELECT cv.id, cv.entregaprogramada as "entregaprogramada", cp.nomecompleto as "cliente"
                            FROM com_venda cv
                            LEFT JOIN cad_pessoa cp ON (cv.idcliente = cp.id) 
                            WHERE cv.entregaprogramada is not null 
                                AND cv.digitado = false
                            ORDER BY cv.entregaprogramada ASC`
                            , { type: db.Sequelize.QueryTypes.SELECT }
                        );

                        let body = `
                            <div id="tablebody" class="col-md-12">  
                                <h4 align="center"> Pré-Vendas </h4>
                                <table border="1" cellpadding="1" cellspacing="0" style="border-collapse:collapse; width:100%">
                                    <tr>
                                        <td style="text-align:center;"><strong>Entregar em</strong></td>
                                        <td style="text-align:center;"><strong>Cliente</strong></td>
                                        <td style="text-align:center;"><strong>Itens</strong></td>
                                        <td style="text-align:center;"><strong>Ação</strong></td>
                                    </tr>
                                    `;
                        for (let i = 0; i < prevendas.length; i++) {

                            let prevendasitens = await db.sequelize.query(
                                `SELECT vi.qtd, ci.descricao 
                                FROM com_vendaitem vi 
                                LEFT JOIN cad_item ci on vi.iditem = ci.id
                                WHERE vi.idvenda = :idvenda`
                                , {
                                    type: db.Sequelize.QueryTypes.SELECT
                                    , replacements: {
                                        idvenda: prevendas[i].id
                                    }
                                });

                            let itens = '';
                            for (let j = 0; j < prevendasitens.length; j++) {
                                itens += prevendasitens[j].qtd + ` un - ` + prevendasitens[j].descricao + ` `;
                            }

                            body += `
                            <tr>
                                <td style="text-align:center;"> ${application.formatters.fe.datetime(prevendas[i].entregaprogramada)}   </td>
                                <td style="text-align:center;">  ${prevendas[i].cliente}   </td>
                                <td style="text-align:center;"> ${itens} </td>
                                <td style="text-align:center;">  
                                    <a href="/v/venda/${prevendas[i].id}">
                                        <button type="button" style="border-radius: 4px" class="btn btn-primary btn-block btn-lg"><i class="fa fa-pencil-square-o"></i></button>
                                    </a>  
                                </td>
                            </tr>
                            `;
                        }
                        body += `
                        </table>
                        </div>`;

                        return application.success(obj.res, { body });
                    } catch (err) {
                        return application.fatal(obj.res, err);
                    }
                }
                , e_cancelarVenda: async function (obj) {
                    try {
                        if (obj.ids.length <= 0) {
                            return application.error(obj.res, { msg: application.message.selectOneEvent });
                        }
                        let venda = await db.getModel('com_venda').findOne({ where: { id: obj.ids[0] } });
                        if (!venda) {
                            return application.error(obj.res, { msg: 'Venda não encontrada' });
                        }
                        await db.getModel('fin_mov').destroy({ iduser: obj.req.user.id, where: { idvenda: venda.id } });
                        await db.getModel('est_mov').destroy({ iduser: obj.req.user.id, where: { identificacao: 'VENDA' + venda.id } });
                        venda.digitado = false;
                        venda.editado = true;
                        await venda.save();
                        return application.success(obj.res, { msg: application.message.success, reloadtables: true });
                    } catch (err) {
                        return application.fatal(obj.res, err);
                    }
                }
            }
            , precovenda: {
                onsave: async function (obj, next) {
                    try {
                        if (obj.register.id == 0) {
                            obj.register.datahora = moment();
                        }
                        next(obj);
                    } catch (err) {
                        return application.fatal(obj.res, err);
                    }
                }
                , js_getValorUnitario: async function (obj) {
                    try {
                        if (!obj.data.iditem) {
                            return application.error(obj.res, {});
                        }
                        let item = await db.getModel('com_precovenda').findOne({ where: { iditem: obj.data.iditem }, order: [['datahora', 'desc']] });
                        if (!item) {
                            return application.error(obj.res, { msg: 'Preço não encontrado' });
                        }
                        return application.success(obj.res, { data: application.formatters.fe.decimal(item.precovenda, 2) });
                    } catch (err) {
                        return application.fatal(obj.res, err);
                    }
                }
            }
            , vendapagamento: {
                onsave: async function (obj, next) {
                    try {
                        let formareceb = await db.getModel('fin_formapgto').findOne({ where: { id: obj.register.idformapgto } })
                        if (formareceb.formarecebimento == 'a Prazo' && formareceb.prazo == null && obj.register.vencimento == null) {
                            return application.error(obj.res, { msg: `Venda a prazo. Informe o vencimento` });
                        }
                        next(obj)
                    } catch (err) {
                        return application.fatal(obj.res, err);
                    }
                }
            }
        }
        , evento: {
            onsave: async function (obj, next) {
                try {
                    if (obj.register.id == 0) {
                        let saved = await next(obj);
                        let evento = await db.getModel("eve_evento").findOne({ where: { id: saved.register.id } });
                        main.platform.erp.evento.f_calcularPrazosTarefas(evento);
                    } else if (obj.register.id > 0) {
                        let saved = await next(obj);
                    } else {
                        return application.error(obj.res, { msg: 'Não foram encontradas tarefas para esse tipo de evento.' });
                    }
                } catch (error) {
                    return application.fatal(obj.res, error);
                }
            }
            , f_recalculaPrazos: function () {

            }
            , f_calcularPrazosTarefas: async function (evento) {
                console.log("ID: " + obj.id);
                console.log("Data:" + data);
                let tarefatipoevento = await db.getModel('eve_tarefatipoevento').findAll({ where: { idevetipo: evento.idevetipo } });
                for (let i = 0; i < tarefatipoevento.length; i++) {
                    let tarefa = await db.getModel("eve_tarefa").findOne({ where: { id: tarefatipoevento[i].idtarefa } });
                    let tarefatipoevento2 = await db.getModel("eve_tarefatipoevento").findOne({ where: { idtarefa: tarefa.id, idevetipo: evento.idevetipo } });
                    let eventotarefas = await db.getModel('eve_eventotarefa').create({
                        idtarefa: tarefatipoevento[i].idtarefa
                        , idevento: saved.register.id
                        , prazo: tarefatipoevento2.previsaoinicio ? moment(evento.data_evento, application.formatters.be.date_format).subtract(tarefatipoevento2.previsaoinicio, 'day') : null
                    })
                }
            }
            , e_buscarfornecedores: async function (obj) {
                try {
                    let eventotarefa = await db.getModel('eve_eventotarefa').findOne({ where: { id: obj.id } });
                    let fornecedores = await db.getModel('eve_fornecedorservico').findAll({ where: { idcategoria: eventotarefa.idcategoria } });
                    if (fornecedores.length > 0) {
                        for (let i = 0; i < fornecedores.length; i++) {
                            await db.getModel('eve_eventotarefaorca').create({
                                idfornecedor: fornecedores[i].idfornecedor
                                , valor: ''
                                , ideventotarefa: eventotarefa.id
                            })
                        }
                    } else {
                        return application.error(obj.res, { msg: `Nenhum fornecedor encontrado para a categoria da tarefa.` })
                    }
                    return application.success(obj.res, { msg: application.message.success, reloadtables: true });
                } catch (err) {
                    return application.fatal(obj.res, err);
                }
            }
            , e_solicitarorcamento: async function (obj) {
                try {
                    let eventotarefa = await db.getModel('eve_eventotarefa').findOne({ where: { id: obj.id } });
                    let fornecedoresorca = await db.getModel('eve_eventotarefaorca').findAll({ where: { ideventotarefa: eventotarefa.id } });
                    for (let i = 0; i < fornecedoresorca.length; i++) {
                        console.log(fornecedoresorca[i].idfornecedor)
                        let fornecedor = await db.getModel('cad_pessoa').findOne({ where: { id: fornecedoresorca[i].idfornecedor } });
                        main.platform.mail.f_sendmail({
                            to: [fornecedor.email]
                            , subject: `${eventotarefa.emailassunto}`
                            , html: `${eventotarefa.emailtexto}`
                        });
                    }
                    return application.success(obj.res, { msg: application.message.success, reloadtables: true });
                } catch (err) {
                    return application.fatal(obj.res, err);
                }
            }
        }
        , financeiro: {
            categoria: {
                onsave: async function (obj, next) {
                    try {
                        if (obj.register.id == 0) {
                            if (obj.register.idcategoriapai) {
                                let categoriapai = await db.getModel('fin_categoria').findOne({ where: { id: obj.register.idcategoriapai } });
                                obj.register.dc = categoriapai.dc;
                            } else {
                                obj.register.dc = parseInt(obj.req.body.dc);
                            }
                        }
                        await next(obj);
                        main.erp.financeiro.categoria.f_treeAll();
                    } catch (err) {
                        return application.fatal(obj.res, err);
                    }
                }
                , f_treeAll: function () {
                    let getChildren = function (current, childs) {
                        for (var i = 0; i < childs.length; i++) {
                            if (current.idcategoriapai == childs[i].id) {
                                if (childs[i].idcategoriapai) {
                                    return getChildren(childs[i], childs) + childs[i].descricao + ' - ';
                                } else {
                                    return childs[i].descricao + ' - ';
                                }
                            }
                        }
                    }
                    db.getModel('fin_categoria').findAll().then(categorias => {
                        categorias.map(categoria => {
                            if (categoria.idcategoriapai) {
                                categoria.descricaocompleta = getChildren(categoria, categorias) + categoria.descricao;
                            } else {
                                categoria.descricaocompleta = categoria.descricao;
                            }
                            categoria.save();
                        });
                    });
                }
            }
            , conta: {
                onsave: async function (obj, next) {
                    try {
                        if (obj.register.id == 0) {
                            obj.register.saldoatual = 0;
                        }
                        next(obj);
                    } catch (err) {
                        return application.fatal(obj.res, err);
                    }
                }
                , f_recalculaSaldos: function () {
                    db.sequelize.query(`
                        update fin_conta c set saldoatual = (
                            with saldoanterior as (
                            select c.*
                            , coalesce((select cs.valor from fin_contasaldo cs where cs.idconta = c.id order by datahora desc limit 1), 0) as saldoanterior
                            , coalesce((select max(cs.datahora) from fin_contasaldo cs where cs.idconta = c.id), '1900-01-01':: timestamp ) as datahora
                        from fin_conta c)
                        select (
                            coalesce(sum(mp.valor * case when cat.dc = 1 then - 1 else 1 end), 0)
                            + coalesce(sum(mp.juro * case when cat.dc = 1 then - 1 else 1 end), 0)
                            + coalesce(sum(mp.desconto * case when cat.dc = 1 then 1 else -1 end), 0)
                            ):: decimal(14, 2)
                        from
                        fin_movparc mp
                        left join fin_mov m on(mp.idmov = m.id)
                        left join fin_categoria cat on(m.idcategoria = cat.id)
                        where
                        mp.idconta = c.id
                        and mp.datahora > (select sa.datahora from saldoanterior sa where sa.id = mp.idconta))`
                        , { type: db.sequelize.QueryTypes.UPDATE });
                }
                , js_saldoData: async function (obj) {
                    try {
                        let conta = await db.getModel('fin_conta').findOne({ where: { id: obj.data.idconta } });
                        let saldoanterior = await db.getModel('fin_contasaldo').findOne({ where: { idconta: obj.data.idconta }, order: [['datahora', 'desc']] });
                        let sql = await db.sequelize.query(`
                            select
                            sum(case when c.dc = 1 then(mp.valor - coalesce(mp.desconto, 0) + coalesce(mp.juro, 0)) * -1 else mp.valor - coalesce(mp.desconto, 0) + coalesce(mp.juro, 0) end) as soma
                            from
                            fin_mov m
                            left join fin_movparc mp on(m.id = mp.idmov)
                            left join fin_categoria c on(m.idcategoria = c.id)
                            where
                            mp.idconta = :conta
                            and mp.datahora > :dataini
                            and mp.datahora <= :datafim`
                            , {
                                type: db.sequelize.QueryTypes.SELECT
                                , replacements: {
                                    conta: obj.data.idconta
                                    , dataini: saldoanterior ? saldoanterior.datahora : '1900-01-01 00:00:00'
                                    , datafim: application.formatters.be.date(obj.data.datahora)
                                }
                            });
                        if (sql.length > 0 && sql[0].soma) {
                            return application.success(obj.res, { data: application.formatters.fe.decimal(parseFloat(sql[0].soma) + (saldoanterior ? parseFloat(saldoanterior.valor) : 0), 2) });
                        } else {
                            return application.success(obj.res, { data: application.formatters.fe.decimal(saldoanterior ? parseFloat(saldoanterior.valor) : 0, 2) });
                        }
                    } catch (err) {
                        return application.fatal(obj.res, err);
                    }
                }
            }
            , contasaldo: {
                onsave: async function (obj, next) {
                    try {
                        let count = await db.getModel('fin_contasaldo').count({ where: { id: { [db.Op.ne]: obj.register.id }, datahora: { [db.Op.gt]: obj.register.datahora } } });
                        if (count > 0) {
                            return application.error(obj.res, { msg: 'Existe um fechamento de caixa maior que desta data' });
                        }
                        next(obj);
                    } catch (err) {
                        return application.fatal(obj.res, err);
                    }
                }
            }
            , formapgto: {
                onsave: async function (obj, next) {
                    try {
                        if (obj.register.formarecebimento == 'Vale') {
                            return application.error(obj.res, { msg: 'É obrigatório informar o item de troca.' });
                        }
                        if (obj.register.formarecebimento == 'a Prazo' && obj.register.parcelas == null) {
                            return application.error(obj.res, { msg: 'É obrigatório informar no mínimo 1 parcela para contas a prazo' });
                        }
                        next(obj);
                    } catch (err) {
                        return application.fatal(obj.res, err);
                    }
                }
            }
            , mov: {
                e_baixarTitulos: async function (obj) {
                    try {

                        if (obj.req.method == 'GET') {
                            if (obj.ids.length <= 0) {
                                return application.error(obj.res, { msg: application.message.selectOneEvent });
                            }
                            let body = '';
                            body += '<div class="row no-margin">';
                            body += application.components.html.hidden({ name: 'ids', value: obj.ids.join(',') });
                            body += application.components.html.datetime({
                                width: '4'
                                , label: 'Data/Hora*'
                                , name: 'datahora'
                                , value: moment().format(application.formatters.fe.datetime_format)
                            });
                            body += application.components.html.autocomplete({
                                width: '4'
                                , label: 'Conta*'
                                , name: 'idconta'
                                , model: 'fin_conta'
                                , attribute: 'descricao'
                            });
                            body += '</div><hr>';

                            let valortotalselecionado = 0;
                            for (let i = 0; i < obj.ids.length; i++) {

                                let mov = await db.getModel('fin_mov').findOne({ where: { id: obj.ids[i] }, include: [{ all: true }] });
                                let valoraberto = application.formatters.fe.decimal((await db.sequelize.query(`
                                    select
                                    m.valor - coalesce(
                                        (select sum(mp.valor)
                                        from fin_movparc mp where m.id = mp.idmov)
                                        , 0) as valoraberto
                                    from
                                    fin_mov m
                                    where m.id = :v1`
                                    , {
                                        type: db.sequelize.QueryTypes.SELECT
                                        , replacements: {
                                            v1: mov.id
                                        }
                                    }))[0].valoraberto, 2);
                                valortotalselecionado += parseFloat(application.formatters.be.decimal(valoraberto, 2))

                                body += '<div class="row no-margin">';

                                body += application.components.html.integer({
                                    width: '2'
                                    , label: 'ID'
                                    , name: 'id' + obj.ids[i]
                                    , value: mov.id
                                    , disabled: 'disabled="disabled"'
                                });

                                body += application.components.html.text({
                                    width: '3'
                                    , label: 'Pessoa'
                                    , name: 'cliente' + obj.ids[i]
                                    , value: mov.cad_pessoa ? mov.cad_pessoa.nome : ''
                                    , disabled: 'disabled="disabled"'
                                });

                                body += application.components.html.autocomplete({
                                    width: '3'
                                    , label: 'Forma de Pagamento*'
                                    , name: 'idformapgto'
                                    , model: 'fin_formapgto'
                                    , attribute: 'descricao'
                                    , option: mov.fin_formapgto ? '<option value="' + mov.fin_formapgto.id + '" selected>' + mov.fin_formapgto.descricao + '</option>' : ''
                                });

                                body += application.components.html.decimal({
                                    width: '2'
                                    , label: 'Valor*'
                                    , name: 'valor' + obj.ids[i]
                                    , precision: 2
                                    , value: valoraberto
                                });

                                body += application.components.html.decimal({
                                    width: '1'
                                    , label: 'Juro'
                                    , name: 'juro' + obj.ids[i]
                                    , precision: 2
                                });

                                body += application.components.html.decimal({
                                    width: '1'
                                    , label: 'Desconto'
                                    , name: 'desconto' + obj.ids[i]
                                    , precision: 2
                                });

                                body += '</div><hr>';

                            }

                            body += '<div class="row no-margin">';
                            body += application.components.html.decimal({
                                width: '2 col-sm-offset-6'
                                , label: 'Total Valor'
                                , name: 'valortotal'
                                , precision: 2
                                , disabled: 'disabled="disabled"'
                                , value: application.formatters.fe.decimal(valortotalselecionado, 2)
                            });
                            body += '</div>';

                            return application.success(obj.res, {
                                modal: {
                                    form: true
                                    , fullscreen: true
                                    , id: 'modalevt'
                                    , action: '/event/' + obj.event.id
                                    , title: obj.event.description
                                    , body: body
                                    , footer: '<button type="button" class="btn btn-default" data-dismiss="modal">Cancelar</button> <button type="submit" class="btn btn-primary">Baixar</button>'
                                }
                            });

                        } else {

                            let invalidfields = application.functions.getEmptyFields(obj.req.body, ['ids', 'idconta', 'datahora']);
                            if (invalidfields.length > 0) {
                                return application.error(obj.res, { msg: application.message.invalidFields, invalidfields: invalidfields });
                            }

                            let ids = obj.req.body.ids.split(',');
                            let requiredFields = [];
                            for (let i = 0; i < ids.length; i++) {
                                requiredFields = requiredFields.concat(application.functions.getEmptyFields(obj.req.body, [
                                    'valor' + ids[i]
                                ]));
                            }
                            if (requiredFields.length > 0) {
                                return application.error(obj.res, { msg: application.message.invalidFields, invalidfields: requiredFields });
                            }

                            let fechamento = await db.getModel('fin_contasaldo').findOne({ where: { idconta: obj.req.body.idconta, datahora: { [db.Op.gte]: application.formatters.be.datetime(obj.req.body.datahora) } } });
                            if (fechamento) {
                                return application.error(obj.res, { msg: 'Conta fechada para lançamento nesta data/hora' });
                            }

                            for (let i = 0; i < ids.length; i++) {
                                let mov = await db.getModel('fin_mov').findOne({ where: { id: ids[i] }, include: [{ all: true }] });
                                let movparc = await db.getModel('fin_movparc').create({
                                    valor: application.formatters.be.decimal(obj.req.body['valor' + ids[i]], 2)
                                    , idmov: mov.id
                                    , idformapgto: 1
                                    , idconta: obj.req.body.idconta
                                    , desconto: obj.req.body['desconto' + ids[i]] ? application.formatters.be.decimal(obj.req.body['desconto' + ids[i]], 2) : null
                                    , juro: obj.req.body['juro' + ids[i]] ? application.formatters.be.decimal(obj.req.body['juro' + ids[i]], 2) : null
                                    , datahora: application.formatters.be.datetime(obj.req.body.datahora)
                                    , detalhes: mov.detalhe
                                });
                            }

                            for (let i = 0; i < ids.length; i++) {
                                let valoraberto = parseFloat((await db.sequelize.query(`
                                    select
                                    m.valor - coalesce(
                                        (select sum(mp.valor)
                                        from fin_movparc mp where m.id = mp.idmov)
                                        , 0) as valoraberto
                                    from
                                    fin_mov m
                                    where m.id = :v1`
                                    , {
                                        type: db.sequelize.QueryTypes.SELECT
                                        , replacements: {
                                            v1: ids[i]
                                        }
                                    }))[0].valoraberto);
                                if (valoraberto <= 0) {
                                    let mov = await db.getModel('fin_mov').findOne({ where: { id: ids[i] } });
                                    mov.quitado = true;
                                    await mov.save();
                                }
                            }
                            main.erp.financeiro.conta.f_recalculaSaldos();
                            return application.success(obj.res, { msg: application.message.success, reloadtables: true });
                        }

                    } catch (err) {
                        return application.fatal(obj.res, err);
                    }
                }
                , e_gerarTitulos: async function (obj) {
                    try {

                        if (obj.req.method == 'GET') {

                            let body = '';
                            body += '<div class="row no-margin">';
                            body += application.components.html.autocomplete({
                                width: '12'
                                , label: 'Pessoa*'
                                , name: 'idpessoa'
                                , model: 'cad_pessoa'
                                , attribute: 'nomecompleto'
                            });
                            body += application.components.html.autocomplete({
                                width: '12'
                                , label: 'Categoria*'
                                , name: 'idcategoria'
                                , model: 'fin_categoria'
                                , attribute: 'descricao'
                            });
                            body += application.components.html.date({
                                width: '4'
                                , label: 'Vencimento*'
                                , name: 'datavcto'
                            });
                            body += application.components.html.decimal({
                                width: '4'
                                , label: 'Valor*'
                                , name: 'valor'
                                , precision: 2
                            });
                            body += application.components.html.integer({
                                width: '4'
                                , label: 'Parcelas*'
                                , name: 'parcelas'
                            });
                            body += application.components.html.text({
                                width: '12'
                                , label: 'Detalhes'
                                , name: 'detalhe'
                            });

                            body += '</div>';

                            return application.success(obj.res, {
                                modal: {
                                    form: true
                                    , fullscreen: false
                                    , id: 'modalevt'
                                    , action: '/event/' + obj.event.id
                                    , title: obj.event.description
                                    , body: body
                                    , footer: '<button type="button" class="btn btn-default" data-dismiss="modal">Cancelar</button> <button type="submit" class="btn btn-primary">Baixar</button>'
                                }
                            });

                        } else {

                            let invalidfields = application.functions.getEmptyFields(obj.req.body, ['idpessoa', 'datavcto', 'idcategoria', 'valor', 'parcelas']);
                            if (invalidfields.length > 0) {
                                return application.error(obj.res, { msg: application.message.invalidFields, invalidfields: invalidfields });
                            }

                            let vcto = moment(obj.req.body.datavcto, application.formatters.fe.date_format);
                            for (let i = 0; i < obj.req.body.parcelas; i++) {
                                let mov = await db.getModel('fin_mov').create({
                                    idcategoria: obj.req.body.idcategoria
                                    , idpessoa: obj.req.body.idpessoa
                                    , datavcto: vcto
                                    , valor: parseFloat(application.formatters.fe.decimal(obj.req.body.valor, 2))
                                    , parcela: i + 1 + `/` + obj.req.body.parcelas
                                    , quitado: false
                                    , detalhe: obj.req.body.detalhes
                                });
                                vcto = moment(vcto, application.formatters.fe.date_format).add(30, 'day');
                            }

                            return application.success(obj.res, { msg: application.message.success, reloadtables: true });
                        }

                    } catch (err) {
                        return application.fatal(obj.res, err);
                    }
                }
            }
            , movparc: {
                ondelete: async function (obj, next) {
                    try {
                        let movparcs = await db.getModel('fin_movparc').findAll({ where: { id: { [db.Op.in]: obj.ids } } });
                        let ids = [];
                        for (let i = 0; i < movparcs.length; i++) {
                            let fechamento = await db.getModel('fin_contasaldo').findOne({ where: { idconta: movparcs[i].idconta, datahora: { [db.Op.gte]: movparcs[i].datahora } } });
                            if (fechamento) {
                                return application.error(obj.res, { msg: 'Conta fechada para estorno nesta data/hora' });
                            }
                            ids.push(movparcs[i].idmov);
                        }
                        let movs = await db.getModel('fin_mov').findAll({ where: { id: { [db.Op.in]: ids } } });
                        await next(obj);
                        for (let i = 0; i < movs.length; i++) {
                            movs[i].quitado = false;
                            movs[i].save();
                        }
                        main.erp.financeiro.conta.f_recalculaSaldos();
                    } catch (err) {
                        return application.fatal(obj.res, err);
                    }
                }
                , e_transferencia: async function (obj) {
                    try {

                        if (obj.req.method == 'GET') {

                            let categoriad = await db.getModel('fin_categoria').findOne({ where: { descricaocompleta: 'Transferência - Débito' } });
                            let categoriac = await db.getModel('fin_categoria').findOne({ where: { descricaocompleta: 'Transferência - Crédito' } });

                            let body = '';
                            body += application.components.html.autocomplete({
                                width: '5'
                                , label: 'Categoria de Débito'
                                , name: 'idcategoriad'
                                , model: 'fin_categoria'
                                , attribute: 'descricaocompleta'
                                , where: 'dc = 1'
                                , option: categoriad ? '<option value="' + categoriad.id + '" selected>' + categoriad.descricaocompleta + '</option>' : ''
                            });
                            body += application.components.html.autocomplete({
                                width: '4'
                                , label: 'Conta de Débito'
                                , name: 'idcontad'
                                , model: 'fin_conta'
                                , attribute: 'descricao'
                            });
                            body += application.components.html.autocomplete({
                                width: '3'
                                , label: 'Forma Pgto'
                                , name: 'idformapgtod'
                                , model: 'fin_formapgto'
                                , attribute: 'descricao'
                            });
                            body += application.components.html.autocomplete({
                                width: '5'
                                , label: 'Categoria de Crédito'
                                , name: 'idcategoriac'
                                , model: 'fin_categoria'
                                , attribute: 'descricaocompleta'
                                , where: 'dc = 2'
                                , option: categoriac ? '<option value="' + categoriac.id + '" selected>' + categoriac.descricaocompleta + '</option>' : ''
                            });
                            body += application.components.html.autocomplete({
                                width: '4'
                                , label: 'Conta de Crédito'
                                , name: 'idcontac'
                                , model: 'fin_conta'
                                , attribute: 'descricao'
                            });
                            body += application.components.html.autocomplete({
                                width: '3'
                                , label: 'Forma de Pgto'
                                , name: 'idformapgtoc'
                                , model: 'fin_formapgto'
                                , attribute: 'descricao'
                            });
                            body += application.components.html.datetime({
                                width: '5'
                                , label: 'Data/Hora'
                                , name: 'datahora'
                                , value: moment().format(application.formatters.fe.datetime_format)
                            });
                            body += application.components.html.decimal({
                                width: '7'
                                , label: 'Valor'
                                , name: 'valor'
                                , precision: '2'
                            });
                            body += application.components.html.text({
                                width: '12'
                                , label: 'Detalhe'
                                , name: 'detalhe'
                            });

                            return application.success(obj.res, {
                                modal: {
                                    form: true
                                    , id: 'modalevt'
                                    , action: '/event/' + obj.event.id
                                    , title: obj.event.description
                                    , body: body
                                    , footer: '<button type="button" class="btn btn-default" data-dismiss="modal">Cancelar</button> <button type="submit" class="btn btn-primary">Transferir</button>'
                                }
                            });

                        } else {

                            let invalidfields = application.functions.getEmptyFields(obj.req.body, ['idcategoriad', 'idcontad', 'idformapgtod', 'idcategoriac', 'idcontac', 'idformapgtoc', 'datahora', 'valor']);
                            if (invalidfields.length > 0) {
                                return application.error(obj.res, { msg: application.message.invalidFields, invalidfields: invalidfields });
                            }
                            let valor = application.formatters.be.decimal(obj.req.body.valor, 2);
                            let datahora = application.formatters.be.datetime(obj.req.body.datahora);

                            if (parseFloat(valor) <= 0) {
                                return application.error(obj.res, { msg: 'O valor deve ser maior que 0', invalidfields: ['valor'] });
                            }
                            let fechamento = await db.getModel('fin_contasaldo').findOne({ include: [{ all: true }], where: { idconta: obj.req.body.idcontad, datahora: { [db.Op.gte]: application.formatters.be.datetime(obj.req.body.datahora) } } });
                            if (fechamento) {
                                return application.error(obj.res, { msg: `Conta ${fechamento.fin_conta.descricao} fechada para lançamento nesta data/hora` });
                            }
                            fechamento = await db.getModel('fin_contasaldo').findOne({ include: [{ all: true }], where: { idconta: obj.req.body.idcontac, datahora: { [db.Op.gte]: application.formatters.be.datetime(obj.req.body.datahora) } } });
                            if (fechamento) {
                                return application.error(obj.res, { msg: `Conta ${fechamento.fin_conta.descricao} fechada para lançamento nesta data/hora` });
                            }

                            let movd = await db.getModel('fin_mov').create({
                                datavcto: datahora
                                , idcategoria: obj.req.body.idcategoriad
                                , valor: valor
                                , quitado: true
                                , detalhe: obj.req.body.detalhe || null
                            });
                            let movparcd = await db.getModel('fin_movparc').create({
                                valor: valor
                                , idmov: movd.id
                                , idformapgto: obj.req.body.idformapgtod
                                , idconta: obj.req.body.idcontad
                                , datahora: datahora
                            });

                            let movc = await db.getModel('fin_mov').create({
                                datavcto: datahora
                                , idcategoria: obj.req.body.idcategoriac
                                , valor: valor
                                , quitado: true
                                , detalhe: obj.req.body.detalhe || null
                            });
                            let movparcc = await db.getModel('fin_movparc').create({
                                valor: valor
                                , idmov: movc.id
                                , idformapgto: obj.req.body.idformapgtoc
                                , idconta: obj.req.body.idcontac
                                , datahora: datahora
                            });

                            main.erp.financeiro.conta.f_recalculaSaldos();

                            return application.success(obj.res, { msg: application.message.success, reloadtables: true });
                        }

                    } catch (err) {
                        return application.fatal(obj.res, err);
                    }
                }
            }
        }
        , suprimentos: {
            estoque: {
                f_atualizarSaldoItemTroca: async function (obj, next) {
                    try {
                        let item = await db.getModel('cad_item').findOne({ where: { id: obj.iditem } });
                        db.getModel('cad_item').update({ estoqueatual: item.estoqueatual + 1, estoqueproprio: item.estoqueproprio + 1 }, { where: { id: obj.iditem } });
                    } catch (err) {
                        return application.fatal(obj.res, err);
                    }
                }
            }
        }
    }
}

module.exports = main;